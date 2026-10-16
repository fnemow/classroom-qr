using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;

namespace ClassroomQr;

// Share each upstream resource between playback and detection. Listen only on loopback.
public sealed partial class StreamRelay : IAsyncDisposable
{
    sealed record Resource(byte[] Bytes,string ContentType,Uri Location,bool Playlist);
    sealed class Entry { public required Lazy<Task<Resource>> Value; public DateTimeOffset Expires=DateTimeOffset.MaxValue; }
    readonly TcpListener listener=new(IPAddress.Loopback,0);
    readonly CancellationTokenSource cancel=new();
    readonly HttpClient http=new(new SocketsHttpHandler {MaxConnectionsPerServer=3,AutomaticDecompression=DecompressionMethods.All}) {Timeout=TimeSpan.FromSeconds(20)};
    readonly Dictionary<string,Entry> cache=[];
    readonly HashSet<Task> clients=[];
    readonly object gate=new();
    readonly string secret=Guid.NewGuid().ToString("N");
    readonly Task accepting;
    readonly string root;
    public string PlaybackUrl {get;}
    public StreamRelay(Uri source)
    {
        listener.Start();
        root=$"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/{secret}/";
        PlaybackUrl=Local(source); accepting=Accept();
    }
    string Local(Uri uri)
    {
        var key=Convert.ToBase64String(Encoding.UTF8.GetBytes(uri.AbsoluteUri)).TrimEnd('=').Replace('+','-').Replace('/','_');
        string extension=Path.GetExtension(uri.AbsolutePath).ToLowerInvariant();
        if(extension is not (".m3u8" or ".ts" or ".m4s" or ".mp4" or ".aac" or ".key" or ".vtt")) extension=".ts";
        return root+key+"/media"+extension;
    }
    async Task Accept()
    {
        try
        {
            while(!cancel.IsCancellationRequested)
            {
                var client=await listener.AcceptTcpClientAsync(cancel.Token);
                var task=Serve(client); lock(gate) clients.Add(task);
                _=task.ContinueWith(t=>{lock(gate) clients.Remove(t);},TaskScheduler.Default);
            }
        }
        catch(OperationCanceledException) {} catch(SocketException) when(cancel.IsCancellationRequested) {}
    }
    async Task<Resource> Fetch(Uri uri)
    {
        string key=uri.AbsoluteUri; Entry entry;
        lock(gate)
        {
            if(cache.TryGetValue(key,out var cached) && cached.Expires>DateTimeOffset.UtcNow) entry=cached;
            else {entry=new Entry {Value=new(()=>Download(uri))}; cache[key]=entry;}
            // Retain at most 64 MiB / 128 completed resources, newest first.
            long bytes=0;
            foreach(var pair in cache.Reverse().ToArray())
            {
                var value=pair.Value.Value;
                if(!value.IsValueCreated || !value.Value.IsCompletedSuccessfully) continue;
                bytes+=value.Value.Result.Bytes.LongLength;
                if((bytes>64*1024*1024 || cache.Count>128) && pair.Key!=key) cache.Remove(pair.Key);
            }
        }
        try
        {
            var result=await entry.Value.Value;
            lock(gate) if(entry.Expires==DateTimeOffset.MaxValue) entry.Expires=DateTimeOffset.UtcNow.AddMilliseconds(result.Playlist?450:60000);
            return result;
        }
        catch {lock(gate) {if(cache.TryGetValue(key,out var current)&&ReferenceEquals(current,entry)) cache.Remove(key);} throw;}
    }
    async Task<Resource> Download(Uri uri)
    {
        using var response=await http.GetAsync(uri,HttpCompletionOption.ResponseHeadersRead,cancel.Token);
        response.EnsureSuccessStatusCode();
        if(response.Content.Headers.ContentLength>32*1024*1024) throw new IOException("直播分片超过缓存大小限制");
        await using var input=await response.Content.ReadAsStreamAsync(cancel.Token);
        using var output=new MemoryStream(); var buffer=new byte[65536]; int count;
        while((count=await input.ReadAsync(buffer,cancel.Token))>0)
        {if(output.Length+count>32*1024*1024) throw new IOException("直播分片超过缓存大小限制");output.Write(buffer,0,count);}
        var bytes=output.ToArray();
        bool playlist=Encoding.UTF8.GetString(bytes,0,Math.Min(bytes.Length,16)).TrimStart('\uFEFF').StartsWith("#EXTM3U");
        return new(bytes,playlist?"application/vnd.apple.mpegurl":response.Content.Headers.ContentType?.MediaType??"application/octet-stream",response.RequestMessage?.RequestUri??uri,playlist);
    }
    byte[] Rewrite(Resource resource)
    {
        var lines=Encoding.UTF8.GetString(resource.Bytes).TrimStart('\uFEFF').Split('\n');
        var segments=new List<Uri>();
        for(int i=0;i<lines.Length;i++)
        {
            string line=lines[i].TrimEnd('\r');
            if(line.StartsWith('#')) line=UriAttribute().Replace(line,m=>"URI=\""+Local(Resolve(resource.Location,m.Groups[1].Value))+"\"");
            else if(!string.IsNullOrWhiteSpace(line))
            {
                var uri=Resolve(resource.Location,line.Trim());
                if(!uri.AbsolutePath.EndsWith(".m3u8",StringComparison.OrdinalIgnoreCase)) segments.Add(uri);
                line=Local(uri);
            }
            lines[i]=line;
        }
        foreach(var uri in segments.TakeLast(3)) _=Prefetch(uri);
        return Encoding.UTF8.GetBytes(string.Join('\n',lines));
    }
    static Uri Resolve(Uri parent,string value)
    {
        var uri=new Uri(parent,value);
        if((uri.Scheme!="http"&&uri.Scheme!="https")||!string.IsNullOrEmpty(uri.UserInfo)) throw new IOException("不支持的直播资源地址");
        return uri;
    }
    async Task Prefetch(Uri uri) {try {await Fetch(uri);} catch {} }
    async Task Serve(TcpClient client)
    {
        using(client)
        {
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancel.Token); timeout.CancelAfter(TimeSpan.FromSeconds(25));
            var ct=timeout.Token; var stream=client.GetStream();
            try
            {
                using var reader=new StreamReader(stream,Encoding.ASCII,false,4096,true);
                var request=await reader.ReadLineAsync(ct); if(request==null)return;
                var parts=request.Split(' '); if(parts.Length!=3 || (parts[0]!="GET"&&parts[0]!="HEAD")) {await Reply(stream,405,ReadOnlyMemory<byte>.Empty,"text/plain",ct);return;}
                string? range=null;int total=0;
                while(await reader.ReadLineAsync(ct) is {} line && line.Length>0)
                {total+=line.Length;if(total>16384) return;if(line.StartsWith("Range:",StringComparison.OrdinalIgnoreCase))range=line[6..].Trim();}
                string prefix="/"+secret+"/";
                if(!parts[1].StartsWith(prefix,StringComparison.Ordinal)) {await Reply(stream,403,ReadOnlyMemory<byte>.Empty,"text/plain",ct);return;}
                string key=parts[1][prefix.Length..].Split('/')[0].Replace('-','+').Replace('_','/');
                if(key.Length>16384) return; key=key.PadRight((key.Length+3)/4*4,'=');
                var source=new Uri(Encoding.UTF8.GetString(Convert.FromBase64String(key)));
                if((source.Scheme!="http"&&source.Scheme!="https")||!string.IsNullOrEmpty(source.UserInfo))throw new IOException("不支持的地址");
                var resource=await Fetch(source).WaitAsync(ct);
                byte[] data=resource.Playlist?Rewrite(resource):resource.Bytes;
                if(range!=null && !resource.Playlist)
                {
                    var match=RangeHeader().Match(range);
                    if(!match.Success || !long.TryParse(match.Groups[1].Value,out var start) || start>=data.Length)
                    {await Reply(stream,416,ReadOnlyMemory<byte>.Empty,"text/plain",ct);return;}
                    long end=match.Groups[2].Length>0&&long.TryParse(match.Groups[2].Value,out var endValue)?endValue:data.Length-1;
                    end=Math.Min(end,data.Length-1);if(end<start){await Reply(stream,416,ReadOnlyMemory<byte>.Empty,"text/plain",ct);return;}
                    await Reply(stream,206,data.AsMemory((int)start,(int)(end-start+1)),resource.ContentType,ct,parts[0]=="HEAD",$"Content-Range: bytes {start}-{end}/{data.Length}\r\n");
                }
                else await Reply(stream,200,data,resource.ContentType,ct,parts[0]=="HEAD");
            }
            catch(Exception) when(!cancel.IsCancellationRequested)
            {try {await Reply(stream,502,Encoding.UTF8.GetBytes("上游直播暂不可用"),"text/plain",ct);} catch {}}
            catch(OperationCanceledException) {}
        }
    }
    static async Task Reply(Stream stream,int status,ReadOnlyMemory<byte> bytes,string type,CancellationToken ct,bool head=false,string extra="")
    {
        string text=$"HTTP/1.1 {status} {(status==200?"OK":status==206?"Partial Content":"Error")}\r\nContent-Type: {type}\r\nContent-Length: {bytes.Length}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n{extra}\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(text),ct);if(!head)await stream.WriteAsync(bytes,ct);
    }
    [GeneratedRegex("URI=\"([^\"]+)\"")] private static partial Regex UriAttribute();
    [GeneratedRegex(@"^bytes=(\d+)-(\d*)$")] private static partial Regex RangeHeader();
    public async ValueTask DisposeAsync()
    {
        cancel.Cancel();listener.Stop();await accepting;
        Task[] tasks;lock(gate)tasks=clients.ToArray();
        try {await Task.WhenAll(tasks);} catch {}
        http.Dispose();cancel.Dispose();
    }
}
