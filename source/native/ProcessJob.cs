using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace ClassroomQr;
// A killed Chrome native host must not leave an FFmpeg process behind.
public sealed class ProcessJob : IDisposable
{
    sealed class Handle : SafeHandleZeroOrMinusOneIsInvalid
    {
        public Handle() : base(true) {}
        protected override bool ReleaseHandle() => CloseHandle(handle);
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long ProcessTime,JobTime; public uint Flags; public nuint MinWorking,MaxWorking; public uint ActiveProcesses; public nuint Affinity; public uint Priority,Scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit Basic; public IoCounters Io; public nuint ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern Handle CreateJobObject(nint security,string? name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(Handle h,int info,ref ExtendedLimit limits,uint size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(Handle h,nint process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(nint h);
    readonly Handle handle;
    ProcessJob(Handle h) { handle=h; }
    public static ProcessJob Attach(Process process)
    {
        var h=CreateJobObject(0,null);
        var limits=new ExtendedLimit {Basic=new BasicLimit {Flags=0x2000}};
        if(h.IsInvalid || !SetInformationJobObject(h,9,ref limits,(uint)Marshal.SizeOf<ExtendedLimit>()) || !AssignProcessToJobObject(h,process.Handle))
        { h.Dispose(); try {process.Kill(true);} catch {} throw new IOException("无法为视频解码器创建进程清理保护。"); }
        return new(h);
    }
    public void Dispose() => handle.Dispose();
}
