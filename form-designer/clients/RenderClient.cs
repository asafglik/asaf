// C# (.NET 6+) example
using System.Net.Http;
using System.Text;

public static class FormRenderClient
{
    static readonly HttpClient Http = new() { BaseAddress = new Uri("http://localhost:3700"), Timeout = TimeSpan.FromMinutes(2) };

    public static async Task<byte[]> RenderAsync(string templateId, string xmlOrJson, string? apiKey = null)
    {
        var mediaType = xmlOrJson.TrimStart().StartsWith("<") ? "application/xml" : "application/json";
        using var req = new HttpRequestMessage(HttpMethod.Post, $"/api/render/{Uri.EscapeDataString(templateId)}")
        {
            Content = new StringContent(xmlOrJson, Encoding.UTF8, mediaType)
        };
        if (!string.IsNullOrEmpty(apiKey)) req.Headers.Add("x-api-key", apiKey);
        using var res = await Http.SendAsync(req);
        if (!res.IsSuccessStatusCode)
            throw new Exception($"Render failed ({(int)res.StatusCode}): {await res.Content.ReadAsStringAsync()}");
        return await res.Content.ReadAsByteArrayAsync();
    }
}
