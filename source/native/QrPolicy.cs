using System.Text.Json;
namespace ClassroomQr;
public sealed record QrRule(string Id,string Action,string Kind,string Pattern);
public sealed class QrPolicy(QrRule[] rules)
{
    public static QrRule[] Defaults=>[new("chaoxing-sign","allow","urlPath","https://mobilelearn.chaoxing.com/widget/sign/e")];
    public static QrPolicy Parse(JsonElement message)
    {
        if(!message.TryGetProperty("qrRules",out var values))return new(Defaults);
        if(values.ValueKind!=JsonValueKind.Array||values.GetArrayLength()>100)throw new InvalidDataException("二维码规则必须为最多 100 条的数组");
        var result=new List<QrRule>();
        foreach(var value in values.EnumerateArray())
        {
            string Field(string key)=>value.GetProperty(key).GetString()??"";
            var rule=new QrRule(Field("id"),Field("action"),Field("kind"),Field("pattern"));
            if(rule.Id.Length>100||rule.Pattern.Length is <1 or >8192||rule.Action is not ("allow" or "block")||rule.Kind is not ("exact" or "contains" or "urlPath"))throw new InvalidDataException("二维码规则无效");
            if(rule.Kind=="urlPath"&&!WebUri(rule.Pattern,out _))throw new InvalidDataException("规则需要 HTTP/HTTPS 地址");
            result.Add(rule);
        }
        return new(result.ToArray());
    }
    static bool WebUri(string text,out Uri? uri)=>Uri.TryCreate(text,UriKind.Absolute,out uri)&&uri.Scheme is "http" or "https"&&string.IsNullOrEmpty(uri.UserInfo);
    static bool Matches(QrRule rule,string text)
    {
        if(rule.Kind=="exact")return text==rule.Pattern;
        if(rule.Kind=="contains")return text.Contains(rule.Pattern,StringComparison.Ordinal);
        return WebUri(text,out var actual)&&WebUri(rule.Pattern,out var expected)&&actual!.Scheme==expected!.Scheme&&actual.Host==expected.Host&&actual.Port==expected.Port&&actual.AbsolutePath==expected.AbsolutePath;
    }
    public (string Decision,string? RuleId) Classify(string text)
    {
        foreach(var action in new[]{"block","allow"})foreach(var rule in rules)if(rule.Action==action&&Matches(rule,text))return (action=="allow"?"attendance":"blocked",rule.Id);
        return ("unknown",null);
    }
}
