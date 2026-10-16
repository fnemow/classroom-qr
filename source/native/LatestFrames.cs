using System.Threading.Channels;

namespace ClassroomQr;
public sealed class LatestFrames : IAsyncDisposable
{
    public sealed record Sample(VideoFrame Frame, DateTimeOffset At);
    readonly CancellationTokenSource cancel;
    readonly Channel<Sample> frames=Channel.CreateBounded<Sample>(new BoundedChannelOptions(1)
        {FullMode=BoundedChannelFullMode.DropOldest,SingleWriter=true,SingleReader=true});
    public ChannelReader<Sample> Reader=>frames.Reader;
    public Task Pump {get;}
    public LatestFrames(Stream stream,CancellationToken ct)
    {cancel=CancellationTokenSource.CreateLinkedTokenSource(ct);Pump=Task.Run(()=>Read(stream));}
    async Task Read(Stream stream)
    {
        try
        {
            while(!cancel.IsCancellationRequested)
            {
                using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancel.Token);
                timeout.CancelAfter(TimeSpan.FromSeconds(20));
                var frame=await Decoder.ReadFrame(stream,timeout.Token);
                if(frame==null) break;
                frames.Writer.TryWrite(new(frame,DateTimeOffset.UtcNow));
            }
            frames.Writer.TryComplete();
        }
        catch(Exception e) {frames.Writer.TryComplete(e);}
    }
    public async ValueTask DisposeAsync() {cancel.Cancel();await Pump;cancel.Dispose();}
}
