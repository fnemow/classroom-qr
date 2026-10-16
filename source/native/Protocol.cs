using System.Buffers.Binary;
using System.Text.Json;

namespace ClassroomQr;
public sealed class Protocol(Stream input, Stream output)
{
    readonly SemaphoreSlim gate = new(1, 1);
    public async Task<JsonDocument?> Read()
    {
        byte[] header = new byte[4];
        var first = await input.ReadAsync(header.AsMemory(0, 1));
        if (first == 0) return null;
        await input.ReadExactlyAsync(header.AsMemory(1));
        int size = BinaryPrimitives.ReadInt32LittleEndian(header);
        if (size < 2 || size > 65536) throw new InvalidDataException("Invalid message size");
        byte[] bytes = new byte[size]; await input.ReadExactlyAsync(bytes);
        return JsonDocument.Parse(bytes);
    }
    public async Task Send(object value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        if (bytes.Length > 1000000) throw new InvalidDataException("Message too large");
        byte[] header = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(header, bytes.Length);
        await gate.WaitAsync();
        try { await output.WriteAsync(header); await output.WriteAsync(bytes); await output.FlushAsync(); }
        finally { gate.Release(); }
    }
}
