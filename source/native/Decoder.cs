using System.Diagnostics;
using System.Text;
using ZXing;
using ZXing.Common;

namespace ClassroomQr;
public record VideoFrame(int Width, int Height, byte[] Pixels);
public static class Decoder
{
    public static async Task<VideoFrame?> ReadFrame(Stream stream, CancellationToken ct)
    {
        async Task<string?> Token()
        {
            var text = new StringBuilder(); var b = new byte[1];
            while (true)
            {
                if (await stream.ReadAsync(b, ct) == 0) return text.Length == 0 ? null : throw new EndOfStreamException();
                char c = (char)b[0];
                if (char.IsWhiteSpace(c)) { if (text.Length > 0) return text.ToString(); continue; }
                if (text.Length > 24) throw new InvalidDataException("Invalid PPM header");
                text.Append(c);
            }
        }
        var magic = await Token(); if (magic == null) return null;
        if (magic != "P6") throw new InvalidDataException("Expected P6 video frame");
        if (!int.TryParse(await Token(), out int w) || !int.TryParse(await Token(), out int h) || w < 1 || h < 1 || (long)w*h > 20000000)
            throw new InvalidDataException("Invalid video dimensions");
        if (await Token() != "255") throw new InvalidDataException("Unsupported PPM depth");
        var bytes = new byte[checked(w*h*3)]; await stream.ReadExactlyAsync(bytes, ct);
        return new VideoFrame(w,h,bytes);
    }
    public static BarcodeReaderGeneric CreateReader() => new()
    {
        AutoRotate = true,
        Options = new DecodingOptions { PossibleFormats = [BarcodeFormat.QR_CODE], TryHarder = true, TryInverted = true }
    };
    public static string? Decode(BarcodeReaderGeneric reader, VideoFrame frame) =>
        reader.Decode(new RGBLuminanceSource(frame.Pixels, frame.Width, frame.Height, RGBLuminanceSource.BitmapFormat.RGB24))?.Text;
    public static string[] DecodeAll(BarcodeReaderGeneric reader,VideoFrame frame)=>
        (reader.DecodeMultiple(new RGBLuminanceSource(frame.Pixels,frame.Width,frame.Height,RGBLuminanceSource.BitmapFormat.RGB24))??[]).Select(x=>x.Text).Distinct().ToArray();
    public static Process Start(string url)
    {
        string ffmpeg = Path.Combine(AppContext.BaseDirectory, "ffmpeg.exe");
        if (!File.Exists(ffmpeg)) throw new FileNotFoundException("缺少 ffmpeg.exe，请重新解压完整发布包。", ffmpeg);
        var info = new ProcessStartInfo(ffmpeg) { UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true };
        foreach (var arg in new[]{"-hide_banner","-loglevel","error","-nostdin","-rw_timeout","15000000","-analyzeduration","2000000","-probesize","1000000","-live_start_index","-1","-protocol_whitelist","http,https,tcp,tls,crypto,httpproxy","-i",url,"-map","0:v:0","-an","-sn","-dn","-vf","fps=2","-pix_fmt","rgb24","-c:v","ppm","-f","image2pipe","pipe:1"}) info.ArgumentList.Add(arg);
        var process = Process.Start(info) ?? throw new IOException("无法启动 FFmpeg");
        return process;
    }
}
