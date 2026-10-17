using System.Diagnostics;
using System.Text.Json;

namespace ClassroomQr;
public sealed class Host(Protocol protocol) : IAsyncDisposable
{
    readonly WindowsEffects effects = new();
    readonly SemaphoreSlim effectsGate = new(1,1);
    CancellationTokenSource? cancel;
    CancellationTokenSource? testCancel;
    Task? loop;
    Task? pulse;
    string? current;
    StreamRelay? relay;
    volatile QrPolicy qrPolicy=new(QrPolicy.Defaults);
    Task Emit(string id,string type,object? data=null) => protocol.Send(new {sessionId=id,type,data});
    Task Status(string id,string state,string message) => protocol.Send(new {sessionId=id,type="status",state,message});
    Task Error(string id,string message) => protocol.Send(new {sessionId=id,type="error",message});
    Task Effects(string id) => protocol.Send(new {sessionId=id,type="effects",sound=effects.Sound,pinned=effects.Pinned});
    public async Task Command(JsonElement message)
    {
        string id=message.GetProperty("sessionId").GetString() ?? "";
        if (!Guid.TryParse(id,out _)) throw new InvalidDataException("Invalid session ID");
        string command=message.GetProperty("command").GetString() ?? "";
        if(command=="hello") { await protocol.Send(new {sessionId=id,type="ready",version="1.2.1",qrFiltering=true,qrLogging=true}); return; }
        if(command=="start")
        {
            var nextPolicy=QrPolicy.Parse(message);
            bool suppressAlert=message.TryGetProperty("suppressAlert",out var suppress)&&suppress.GetBoolean();
            string url=message.GetProperty("url").GetString() ?? "";
            string token=message.GetProperty("windowToken").GetString() ?? "";
            if(!Uri.TryCreate(url,UriKind.Absolute,out var uri) || (uri.Scheme!="http" && uri.Scheme!="https") || !string.IsNullOrEmpty(uri.UserInfo) || url.Length>8192)
                { await Error(id,"请输入有效的 HTTP/HTTPS 直播地址。"); await Status(id,"error","直播地址无效"); return; }
            if(token.Length!=41 || !token.StartsWith("[CQ-") || !token.EndsWith(']') || !Guid.TryParse(token[4..^1],out _))
                { await Error(id,"直播窗口标识无效。"); return; }
            await Stop(); qrPolicy=nextPolicy;current=id; cancel=new(); await Effects(id);
            await Status(id,"connecting","正在连接直播，等待第一帧…");
            relay=new StreamRelay(uri);
            await protocol.Send(new {sessionId=id,type="playback",url=relay.PlaybackUrl});
            pulse=Pulse(id,cancel.Token);
            bool detectEnabled=!message.TryGetProperty("detectEnabled",out var detect) || detect.GetBoolean(); if(detectEnabled) loop=Monitor(id,relay.PlaybackUrl,token,cancel.Token,suppressAlert); else await Status(id,"alerted","本课已提醒，当前仅播放；可点击重新监控"); return;
        }
        if(command=="testSound")
        {
            await effectsGate.WaitAsync();
            try
            {
                if(effects.Sound) return;
                testCancel?.Cancel(); testCancel=new(); var testToken=testCancel.Token;
                effects.Play(); await Effects(id);
                _=EndTest(id,testToken);
            }
            finally { effectsGate.Release(); }
            return;
        }
        // Delayed commands from replaced sessions cannot control the new monitor.
        if(command!="silence" && !(command=="stop" && current==null) && id!=current) return;
        if(command=="setQrRules") {qrPolicy=QrPolicy.Parse(message);await Status(id,"monitoring","二维码规则已更新，正在持续记录");return;}
        if(command=="stop") { await Stop(); await Status(id,"stopped","监控已停止"); await Effects(id); return; }
        await effectsGate.WaitAsync();
        try
        {
            if(command=="silence") { if(current!=null && current!=id) return; testCancel?.Cancel(); effects.Silence(); }
            else if(command=="unpin") effects.Unpin();
            else throw new InvalidDataException("Unknown command");
            await Effects(id);
        }
        finally { effectsGate.Release(); }
    }
    async Task Pulse(string id,CancellationToken ct)
    {
        try {while(true) {await Task.Delay(1000,ct);await protocol.Send(new {sessionId=id,type="tick"});}}
        catch(OperationCanceledException) when(ct.IsCancellationRequested) {}
        catch(IOException) {}
    }
    async Task EndTest(string id,CancellationToken ct)
    {
        try
        {
            await Task.Delay(1800,ct); await effectsGate.WaitAsync(ct);
            try { if(ct.IsCancellationRequested) return; effects.Silence(); await Effects(id); }
            finally { effectsGate.Release(); }
        }
        catch(OperationCanceledException) { }
        catch(Exception e) { Console.Error.WriteLine(e.Message); }
    }
    async Task Monitor(string id,string url,string marker,CancellationToken ct,bool alerted=false)
    {
        int retry=0; var reader=Decoder.CreateReader();
        while(!ct.IsCancellationRequested)
        {
            Process? process=null;
            try
            {
                process=Decoder.Start(url);
                using var job = ProcessJob.Attach(process);
                using var kill = ct.Register(()=>Kill(process));
                // Drain stderr without retaining stream URLs or unbounded diagnostic output.
                var drain=Task.Run(async ()=>{var b=new char[4096];try { while(await process.StandardError.ReadAsync(b,ct)>0) {} } catch(OperationCanceledException) {} });
                bool received=false;
                await using var latest=new LatestFrames(process.StandardOutput.BaseStream,ct);
                await foreach(var sample in latest.Reader.ReadAllAsync(ct))
                {
                    var frame=sample.Frame;
                    ct.ThrowIfCancellationRequested();
                    if(!received) { received=true; retry=0; await Status(id,"monitoring","正在检测二维码（每秒 2 帧）"); }
                    var at=sample.At;
                    await protocol.Send(new {sessionId=id,type="frame",at,width=frame.Width,height=frame.Height});
                    var texts=Decoder.DecodeAll(reader,frame);
                    ct.ThrowIfCancellationRequested();
                    foreach(var text in texts)
                    {
                    var (decision,ruleId)=qrPolicy.Classify(text);
                    bool stale=DateTimeOffset.UtcNow-at>TimeSpan.FromSeconds(2);
                    await protocol.Send(new {sessionId=id,type="qr",at,text,decision,ruleId,stale});
                    if(decision!="attendance"||stale||alerted)continue;
                    alerted=true;
                    await effectsGate.WaitAsync(ct);
                    try
                    {
                        testCancel?.Cancel();
                        await protocol.Send(new {sessionId=id,type="alert",at,text=text.Length>8192?text[..8192]:text});
                        try { effects.Play(); } catch(Exception e) { await Error(id,"提醒音播放失败："+e.Message); }
                        try { effects.Pin(marker); } catch(Exception e) { await Error(id,e.Message); }
                        await Effects(id); await Status(id,"alerted","已发现课堂签到码，持续记录中；本次不重复报警");
                    }
                    finally { effectsGate.Release(); }
                    }
                }
                throw new IOException("视频连接结束");
            }
            catch(OperationCanceledException) when(ct.IsCancellationRequested) { return; }
            catch(FileNotFoundException e) { await Error(id,e.Message); await Status(id,"error","检测依赖缺失，请重新安装完整发布包"); return; }
            catch(Exception e) when(!ct.IsCancellationRequested)
            {
                if(process!=null) Kill(process);
                int delay=new[]{2,5,10,30}[Math.Min(retry++,3)];
                await Status(id,"reconnecting",$"正在重连（{delay} 秒）：{e.Message}");
                try { await Task.Delay(TimeSpan.FromSeconds(delay),ct); } catch(OperationCanceledException) { return; }
            }
            finally { if(process!=null) { Kill(process); process.Dispose(); } }
        }
    }
    static void Kill(Process p) { try { if(!p.HasExited) p.Kill(true); } catch(InvalidOperationException) {} catch(System.ComponentModel.Win32Exception) {} }
    async Task Stop()
    {
        testCancel?.Cancel(); cancel?.Cancel();
        if(pulse!=null) {await pulse;pulse=null;}
        if(loop!=null) { try { await loop; } catch(Exception e) { Console.Error.WriteLine(e.Message); } }
        loop=null; cancel?.Dispose(); cancel=null;
        if(relay!=null) {await relay.DisposeAsync();relay=null;}
        await effectsGate.WaitAsync();
        try { effects.Reset(); } finally { effectsGate.Release(); }
        current=null;
    }
    public async ValueTask DisposeAsync() { await Stop(); effects.Dispose(); testCancel?.Dispose(); }
}
