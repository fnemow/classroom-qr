using System.Diagnostics;
using System.Media;
using System.Runtime.InteropServices;
using System.Text;

namespace ClassroomQr;
public sealed class WindowsEffects : IDisposable
{
    delegate bool EnumCallback(nint hwnd, nint param);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback cb, nint p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(nint h, StringBuilder s, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(nint h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindow(nint h);
    [DllImport("user32.dll")] static extern bool IsIconic(nint h);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(nint h, int command);
    [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(nint h, nint after, int x,int y,int w,int height,uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(nint h);
    readonly SoundPlayer alarm = new(Path.Combine(AppContext.BaseDirectory,"alarm.wav"));
    nint handle; string token = "";
    public bool Sound { get; private set; }
    public bool Pinned { get; private set; }
    static bool IsSupportedBrowser(nint h)
    {
        if (!IsWindow(h)) return false;
        try { GetWindowThreadProcessId(h,out var pid); using var p=Process.GetProcessById((int)pid); return p.ProcessName.Equals("chrome",StringComparison.OrdinalIgnoreCase) || p.ProcessName.Equals("msedge",StringComparison.OrdinalIgnoreCase); } catch { return false; }
    }
    static bool Matches(nint h, string marker)
    {
        if (!IsSupportedBrowser(h)) return false;
        var title = new StringBuilder(1024); GetWindowText(h,title,title.Capacity);
        return title.ToString().StartsWith(marker + " ",StringComparison.Ordinal);
    }
    public void Pin(string marker)
    {
        List<nint> matches=[];
        EnumWindows((h,_)=>{if(Matches(h,marker)) matches.Add(h); return true;},0);
        if (matches.Count != 1) throw new IOException("未唯一匹配到直播 Chrome / Edge 窗口；声音仍会提醒。请保持独立窗口打开。");
        token=marker; handle=matches[0];
        if(IsIconic(handle)) ShowWindowAsync(handle,9);
        if(!SetWindowPos(handle,new nint(-1),0,0,0,0,0x0001|0x0002|0x0040)) throw new IOException("Windows 拒绝设置窗口置顶。");
        Pinned=true; SetForegroundWindow(handle);
    }
    public void Unpin()
    {
        if (Pinned && Matches(handle,token) && !SetWindowPos(handle,new nint(-2),0,0,0,0,0x0001|0x0002|0x0010))
            throw new IOException("无法取消窗口置顶，请重试。");
        Pinned=false; handle=0; token="";
    }
    public void Play() { alarm.Load(); alarm.PlayLooping(); Sound=true; }
    public void Silence() { alarm.Stop(); Sound=false; }
    public void Reset() { Silence(); Unpin(); }
    public void Dispose() { try { Reset(); } finally { alarm.Dispose(); } }
}
