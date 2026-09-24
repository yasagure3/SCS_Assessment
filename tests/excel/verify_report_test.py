"""Boundary tests for the independent OOXML oracle; run with Python unittest."""
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from verify_report import decode_xstring, document_url, read_workbook


class ReportOracleTests(unittest.TestCase):
    def test_reads_xml_entities_and_ooxml_escapes_as_cell_values(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "encoded.xlsx"
            with ZipFile(path, "w") as archive:
                archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="サマリー" sheetId="1" r:id="r1"/></sheets></workbook>')
                archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
                archive.writestr("xl/sharedStrings.xml", '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>_x005F_x0041_ &amp; _x000D_\n次行</t></si><si><t></t></si></sst>')
                archive.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>')
            self.assertEqual(read_workbook(path), {"サマリー": [["_x0041_ & \r\n次行", ""]]})

    def test_decodes_xstrings_once_without_reinterpreting_escaped_literals(self):
        cases = [
            ("通常\n\t次行 ", "通常\n\t次行 "),
            ("", ""),
            ("一行目_x000D_\n二行目", "一行目\r\n二行目"),
            ("_x005F_x0041_ _x005F_x000A_", "_x0041_ _x000A_"),
            ("_x005F_x005F_x005F_x0041_", "_x005F_x0041_"),
            ("_x005F_x0041__x005F_x0042_", "_x0041__x0042_"),
            ("_x005F_x0041_x005F_x0042_", "_x0041_x0042_"),
            ("_x0000__x0008__x000B__x000C__x001F__x007F_", "\0\b\v\f\x1f\x7f"),
            ("_x005f_x00aA_", "_x00aA_"),
            ("𠮷 <&>\"'", "𠮷 <&>\"'"),
        ]
        for encoded, expected in cases:
            with self.subTest(encoded=encoded):
                self.assertEqual(decode_xstring(encoded), expected)

    def test_url_fields_retain_public_location_and_omit_credential_name_variants(self):
        public = "https://example.invalid/manual?id=42#page=3"
        self.assertEqual(document_url(public), public)
        for key in ["token", "signature", "credential", "password", "secret", "authorization", "auth", "sig", "key", "code", "apiKey", "APIKey", "APIKEY", "apikey", "api_key", "api-key", "authCode", "AUTHCode", "AUTHCODE", "authcode", "auth_code", "auth-code", "accessKey", "accessToken", "X-Amz-Signature"]:
            for marker in ("?", "#"):
                with self.subTest(key=key, marker=marker):
                    self.assertEqual(document_url(f"https://example.invalid/manual{marker}{key}=ANONYMOUS_SECRET"), "アクセス情報を含むURLのため省略")


if __name__ == "__main__":
    unittest.main()
