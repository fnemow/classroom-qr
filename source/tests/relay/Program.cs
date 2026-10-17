using System.Collections;
using System.Diagnostics;
using System.Reflection;
using ClassroomQr;

using var http = new HttpClient();
var upstream = new Uri(args[0]);
var relay = new StreamRelay(new Uri(upstream, "segment.ts"));
bool disposed = false;
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
int CacheCount()
{
    var flags = BindingFlags.NonPublic | BindingFlags.Instance;
    var gate = typeof(StreamRelay).GetField("gate", flags)!.GetValue(relay)!;
    lock (gate) return ((IDictionary)typeof(StreamRelay).GetField("cache", flags)!.GetValue(relay)!).Count;
}
string Local(string path)
{
    var key = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(new Uri(upstream, path).AbsoluteUri))
        .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    return relay.PlaybackUrl[..relay.PlaybackUrl.LastIndexOf("/", relay.PlaybackUrl.LastIndexOf("/") - 1)] + "/" + key + "/media.ts";
}
try {
var first = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => http.GetStringAsync(relay.PlaybackUrl)));
Check(first.All(x => x == "segment:1"), "Concurrent consumers must share one upstream download");
await Task.Delay(600);
Check(await http.GetStringAsync(relay.PlaybackUrl) == "segment:1", "Segment must remain reusable within ten seconds");
var slow = http.GetStringAsync(Local("slow.ts"));
// No more relay requests: idle cleanup must evict the completed segment but keep the in-flight download.
await Task.Delay(11000);
Check(CacheCount() == 1, "Idle cleanup must remove expired segments and retain the in-flight download");
Check(await http.GetStringAsync(relay.PlaybackUrl) == "segment:2", "Expired segment must be fetched anew");
Check(await slow == "slow:1", "Cleanup must not cancel an in-flight segment");
Check(await http.GetStringAsync(Local("list.m3u8")) == "#EXTM3U\n# fetch 1", "Playlist response");
await Task.Delay(600);
Check(await http.GetStringAsync(Local("list.m3u8")) == "#EXTM3U\n# fetch 2", "Playlist must retain its short refresh interval");
var pending = http.GetAsync(Local("pending.ts"));
await Task.Delay(300);
var watch = Stopwatch.StartNew();
await relay.DisposeAsync();
disposed = true;
Check(watch.Elapsed < TimeSpan.FromSeconds(5), "Stop must promptly cancel in-flight work and cleanup timer");
Check(CacheCount() == 0, "Stop must release all cached resources");
try { using var response = await pending; } catch (HttpRequestException) { }
Console.WriteLine("PASS: shared downloads, ten-second expiry, idle cleanup, in-flight safety, playlist refresh, stop cleanup");
} finally { if (!disposed) await relay.DisposeAsync(); }
