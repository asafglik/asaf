/// Client for the Form Designer render server.
/// Sends a template number and XML/JSON data, receives a PDF.
///
///   Set sc = ##class(FormDesigner.Client).RenderToFile(1001, xmlString, "c:\temp\invoice.pdf")
///   Set sc = ##class(FormDesigner.Client).RenderToStream(1001, xmlStream, .pdf)
Class FormDesigner.Client Extends %RegisteredObject
{

Parameter SERVER = "localhost";

Parameter PORT = 3700;

/// Leave empty when the server runs without FD_API_KEY
Parameter APIKEY;

/// Seconds to wait for the PDF
Parameter TIMEOUT = 120;

/// data: a %String or a stream with the XML / JSON.
/// contentType: "application/xml" or "application/json".
ClassMethod RenderToStream(templateId As %String, data, Output pdf As %Stream.GlobalBinary, contentType As %String = "application/xml") As %Status
{
	Set sc = $$$OK
	Set pdf = ##class(%Stream.GlobalBinary).%New()
	Try {
		Set req = ##class(%Net.HttpRequest).%New()
		Set req.Server = ..#SERVER
		Set req.Port = ..#PORT
		Set req.Timeout = ..#TIMEOUT
		Set req.ContentType = contentType_"; charset=utf-8"
		If ..#APIKEY '= "" Do req.SetHeader("x-api-key", ..#APIKEY)
		If $IsObject(data) {
			Do data.Rewind()
			While 'data.AtEnd {
				Set chunk = data.Read(16000)
				// character streams hold Unicode text: send it as UTF-8
				If data.IsCharacter() Set chunk = $ZConvert(chunk, "O", "UTF8")
				Do req.EntityBody.Write(chunk)
			}
		} Else {
			Do req.EntityBody.Write($ZConvert(data, "O", "UTF8"))
		}
		Set sc = req.Post("/api/render/"_##class(%CSP.Page).EscapeURL(templateId))
		Quit:$$$ISERR(sc)
		Set resp = req.HttpResponse
		If resp.StatusCode '= 200 {
			Set msg = $Select($IsObject(resp.Data): resp.Data.Read(4000), 1: resp.Data)
			Set sc = $$$ERROR($$$GeneralError, "Form render failed ("_resp.StatusCode_"): "_$ZConvert(msg, "I", "UTF8"))
			Quit
		}
		If $IsObject(resp.Data) {
			Set sc = pdf.CopyFrom(resp.Data)
		} Else {
			Do pdf.Write(resp.Data)
		}
		Do pdf.Rewind()
	} Catch ex {
		Set sc = ex.AsStatus()
	}
	Quit sc
}

ClassMethod RenderToFile(templateId As %String, data, fileName As %String, contentType As %String = "application/xml") As %Status
{
	Set sc = ..RenderToStream(templateId, data, .pdf, contentType)
	Quit:$$$ISERR(sc) sc
	Set file = ##class(%Stream.FileBinary).%New()
	Set sc = file.LinkToFile(fileName)
	Quit:$$$ISERR(sc) sc
	Set sc = file.CopyFromAndSave(pdf)
	Quit sc
}

/// The PDF as Base64 (for example to embed in a web page or a SOAP/REST reply)
ClassMethod RenderToBase64(templateId As %String, data, Output base64 As %String, contentType As %String = "application/xml") As %Status
{
	Set base64 = ""
	Set sc = ..RenderToStream(templateId, data, .pdf, contentType)
	Quit:$$$ISERR(sc) sc
	// encode in multiples of 3 bytes so the Base64 chunks join cleanly
	Set buf = ""
	While 'pdf.AtEnd {
		Set buf = buf_pdf.Read(24000)
		Set n = $Length(buf) \ 3 * 3
		Set base64 = base64_$Translate($System.Encryption.Base64Encode($Extract(buf, 1, n)), $Char(13, 10))
		Set buf = $Extract(buf, n + 1, *)
	}
	If buf '= "" Set base64 = base64_$Translate($System.Encryption.Base64Encode(buf), $Char(13, 10))
	Quit $$$OK
}

}
