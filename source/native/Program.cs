using System.Text.Json;
using ClassroomQr;

if(args.Length==2 && args[0]=="--classify-qr")
{
    using var doc=JsonDocument.Parse(await File.ReadAllTextAsync(args[1]));
    var output=doc.RootElement.EnumerateArray().Select(test=>{var result=QrPolicy.Parse(test).Classify(test.GetProperty("text").GetString()??"");return new {decision=result.Decision,ruleId=result.RuleId};});
    Console.WriteLine(JsonSerializer.Serialize(output));return;
}
if(args.Length==2 && args[0]=="--decode-all-ppm")
{
    await using var file=File.OpenRead(args[1]);var reader=Decoder.CreateReader();
    while(await Decoder.ReadFrame(file,CancellationToken.None) is {} frame)
        foreach(var text in Decoder.DecodeAll(reader,frame))Console.WriteLine(JsonSerializer.Serialize(new{text}));
    return;
}

// Test the production bounded frame queue with a deliberately stalled consumer.
if(args.Length==2 && args[0]=="--decode-latest-ppm")
{
    await using var file=File.OpenRead(args[1]);
    await using var latest=new LatestFrames(file,CancellationToken.None);
    await latest.Pump;
    if(latest.Reader.TryRead(out var sample))
        Console.WriteLine(JsonSerializer.Serialize(new {text=Decoder.Decode(Decoder.CreateReader(),sample.Frame),remaining=latest.Reader.TryRead(out _)}));
    return;
}
// Diagnostic mode uses exactly the same frame reader and decoder as monitoring.
if(args.Length==2 && args[0]=="--decode-ppm")
{
    await using var file=File.OpenRead(args[1]); var reader=Decoder.CreateReader(); int count=0,hits=0;
    while(await Decoder.ReadFrame(file,CancellationToken.None) is {} frame)
    { count++; if(Decoder.Decode(reader,frame) is {} text) { hits++; Console.WriteLine(JsonSerializer.Serialize(new {frame=count,text})); } }
    Console.WriteLine(JsonSerializer.Serialize(new {frames=count,hits})); return;
}
// Chrome checks allowed_origins; verify the launch origin too. No arbitrary command execution.
if(args.Length==0 || !Uri.TryCreate(args[0],UriKind.Absolute,out var origin) || origin.Scheme!="chrome-extension" || origin.Host.Length!=32 || origin.Host.Any(c=>c<'a'||c>'p'))
{ Console.Error.WriteLine("Start this application through the Chrome extension."); return; }
var protocol=new Protocol(Console.OpenStandardInput(),Console.OpenStandardOutput());
await using var host=new Host(protocol);
try
{
    while(await protocol.Read() is {} message)
    {
        using(message)
        {
            try { await host.Command(message.RootElement); }
            catch(Exception e) when(e is not EndOfStreamException)
            {
                string id=message.RootElement.TryGetProperty("sessionId",out var session) ? session.GetString()??"" : "";
                await protocol.Send(new {sessionId=id,type="error",message=e.Message});
            }
        }
    }
}
catch(Exception e) { Console.Error.WriteLine(e.Message); }
