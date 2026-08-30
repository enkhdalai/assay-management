from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    PageBreak,
    Preformatted,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = PROJECT_ROOT / "output" / "pdf" / "mongolbank-api-instruction.pdf"

FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def register_fonts():
    pdfmetrics.registerFont(TTFont("DocRegular", FONT_REGULAR))
    pdfmetrics.registerFont(TTFont("DocBold", FONT_BOLD))


def make_styles():
    base = getSampleStyleSheet()
    base.add(
        ParagraphStyle(
            name="CoverTitle",
            fontName="DocBold",
            fontSize=24,
            leading=31,
            textColor=colors.HexColor("#0f172a"),
            spaceAfter=12,
        )
    )
    base.add(
        ParagraphStyle(
            name="CoverSubTitle",
            fontName="DocRegular",
            fontSize=12,
            leading=18,
            textColor=colors.HexColor("#475569"),
            spaceAfter=24,
        )
    )
    base.add(
        ParagraphStyle(
            name="SectionTitle",
            fontName="DocBold",
            fontSize=15,
            leading=20,
            textColor=colors.HexColor("#123b7a"),
            spaceBefore=16,
            spaceAfter=8,
        )
    )
    base.add(
        ParagraphStyle(
            name="BodyMN",
            fontName="DocRegular",
            fontSize=10.3,
            leading=15.5,
            textColor=colors.HexColor("#1f2937"),
            spaceAfter=7,
        )
    )
    base.add(
        ParagraphStyle(
            name="SmallMN",
            fontName="DocRegular",
            fontSize=8.8,
            leading=12.5,
            textColor=colors.HexColor("#475569"),
        )
    )
    base.add(
        ParagraphStyle(
            name="TableHead",
            fontName="DocBold",
            fontSize=8.7,
            leading=11,
            textColor=colors.white,
        )
    )
    base.add(
        ParagraphStyle(
            name="TableCell",
            fontName="DocRegular",
            fontSize=8.2,
            leading=11.2,
            textColor=colors.HexColor("#111827"),
        )
    )
    base.add(
        ParagraphStyle(
            name="CodeMN",
            fontName="DocRegular",
            fontSize=7.6,
            leading=10,
            textColor=colors.HexColor("#111827"),
            backColor=colors.HexColor("#f8fafc"),
            borderColor=colors.HexColor("#dbe3ef"),
            borderWidth=0.4,
            borderPadding=6,
        )
    )
    base.add(
        ParagraphStyle(
            name="CenterSmall",
            parent=base["SmallMN"],
            alignment=TA_CENTER,
        )
    )
    return base


def p(text, style):
    return Paragraph(text, style)


def table(rows, widths, styles):
    converted = []
    for row_index, row in enumerate(rows):
        converted.append([p(str(cell), styles["TableHead" if row_index == 0 else "TableCell"]) for cell in row])

    item = Table(converted, colWidths=widths, hAlign="LEFT", repeatRows=1)
    item.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#123b7a")),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d9e2ef")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
            ]
        )
    )
    return item


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("DocRegular", 8)
    canvas.setFillColor(colors.HexColor("#64748b"))
    canvas.drawString(18 * mm, 12 * mm, "Сорьцын төвийн систем - Монголбанк API заавар")
    canvas.drawRightString(192 * mm, 12 * mm, f"Хуудас {doc.page}")
    canvas.restoreState()


def build_document():
    register_fonts()
    styles = make_styles()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(OUTPUT_PATH),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title="Монголбанк API холболтын заавар",
        author="Assay Management",
    )

    story = [
        Spacer(1, 34 * mm),
        p("Монголбанк API холболтын заавар", styles["CoverTitle"]),
        p(
            "Алт, мөнгөний сорьцын баталгаажсан дүнг Монголбанк талд аюулгүй дамжуулах "
            "интеграцийн зааварчилгааны хувилбар 0.1. Нууц түлхүүр, production endpoint, "
            "байгууллагын бодит зөвшөөрлийн жагсаалтыг энэ файлд оруулаагүй.",
            styles["CoverSubTitle"],
        ),
        table(
            [
                ["Баримтын төлөв", "Дотоод хэлэлцүүлэгт зориулсан draft"],
                ["Огноо", "2026-08-29"],
                ["Хамрах хүрээ", "Монголбанк талын read/confirm integration"],
                ["UI дээр харагдах эсэх", "Хэрэглэгчийн цэсэнд харагдахгүй, зөвхөн PDF заавраар хүргэнэ"],
            ],
            [42 * mm, 105 * mm],
            styles,
        ),
        PageBreak(),
        p("1. Зорилго", styles["SectionTitle"]),
        p(
            "Сорьцын төвүүд алт, мөнгөний сорьцыг хүлээн авч, химич шинжилгээний дүн оруулж, "
            "эрхлэгч баталгаажуулсны дараа Монголбанк зөвхөн баталгаажсан мэдээллийг хүлээн авна. "
            "Монголбанк тал өөрийн системдээ тооцоолол, баталгаажуулалт, төлбөрийн дараагийн алхмыг хэрэгжүүлнэ.",
            styles["BodyMN"],
        ),
        p(
            "Энэ integration нь public signup эсвэл ердийн dashboard menu биш. API гэрээ, түлхүүр, IP зөвшөөрөл, "
            "signature шалгалт зэрэг мэдээллийг зөвхөн эрх бүхий техникийн сувгаар дамжуулна.",
            styles["BodyMN"],
        ),
        p("2. Оролцогч талууд", styles["SectionTitle"]),
        table(
            [
                ["Тал", "Үүрэг", "Харах мэдээлэл"],
                ["Сорьцын төв", "Сорьц бүртгэх, шинжилгээ хийх, баталгаажуулах", "Өөрийн төвийн бүрэн workflow"],
                ["Монголбанк", "Баталгаажсан дүн татах, тооцоолол ба confirmation буцаах", "Баталгаажсан сорьцын дүн, банкны хуваарилалт"],
                ["Арилжааны банк", "Зөвхөн өөрт хуваарилагдсан металлын мэдээлэл харах", "Өөрт оноосон хэмжээ, баталгаажсан дүн"],
                ["Системийн супер админ", "Хэрэглэгч, байгууллага, security policy удирдах", "Бүх байгууллагын удирдлагын мэдээлэл"],
            ],
            [31 * mm, 63 * mm, 63 * mm],
            styles,
        ),
        p("3. Ажлын урсгал", styles["SectionTitle"]),
        table(
            [
                ["Алхам", "Төлөв", "Тайлбар"],
                ["1", "received", "Сорьцын төв металл хүлээн авч, харилцагч болон банкны граммын хуваарилалтыг бүртгэнэ."],
                ["2", "in_analysis", "Химич жин, сорьц, цэвэр жин, аргачлал, багажийн мэдээллийг оруулна."],
                ["3", "manager_review", "Эрхлэгч maker-checker зарчмаар хянаж батална. Оруулсан хэрэглэгч өөрөө батлахгүй."],
                ["4", "approved", "Баталгаажсан дүн түгжигдэж, засвар нь шинэ revision болон audit мөрөөр явна."],
                ["5", "bom_submitted", "Монголбанк API зөвхөн баталгаажсан дүнг татах эсвэл webhook хэлбэрээр хүлээн авна."],
                ["6", "bom_confirmed", "Монголбанк тооцоолол, reference, confirmation төлөв буцааж бүртгүүлнэ."],
            ],
            [16 * mm, 34 * mm, 107 * mm],
            styles,
        ),
        p("4. Аюулгүй байдлын шаардлага", styles["SectionTitle"]),
        table(
            [
                ["Шаардлага", "Заавар"],
                ["Transport", "Зөвхөн HTTPS. Production дээр TLS 1.2 ба түүнээс дээш хувилбар ашиглана."],
                ["Authentication", "Bearer token эсвэл mTLS + signed request. Нууц түлхүүрийг PDF, Git, screenshot-д хадгалахгүй."],
                ["IP allowlist", "Монголбанк талын production outbound IP-г зөвшөөрлийн жагсаалтад оруулна."],
                ["Request signature", "X-Timestamp, X-Request-Id, body hash дээр HMAC-SHA256 signature шалгана."],
                ["Idempotency", "Давхар илгээхээс хамгаалж Idempotency-Key шаардлагатай."],
                ["Audit", "Бүх уншилт, confirmation, алдаатай хүсэлт, signature failure бүр audit log-д бүртгэнэ."],
                ["Data lock", "Баталгаажсан сорьцын дүнг шууд overwrite хийхгүй. Засвар нь шинэ revision үүсгэнэ."],
                ["No image by default", "Одоогийн шаардлагаар зураг хадгалахгүй. Шаардлага нэмэгдвэл тусдаа encrypted object storage policy батална."],
            ],
            [45 * mm, 112 * mm],
            styles,
        ),
        PageBreak(),
        p("5. Санал болгож буй endpoint contract", styles["SectionTitle"]),
        p(
            "Доорх замууд нь Монголбанк талд өгөх тусдаа integration namespace-ийн санал. "
            "Эдгээр нь хэрэглэгчийн dashboard-ийн internal route биш.",
            styles["BodyMN"],
        ),
        table(
            [
                ["Method", "Endpoint", "Зорилго"],
                ["GET", "/bom/v1/assays", "Баталгаажсан сорьцын жагсаалтыг since, centerCode, status filter-ээр татах."],
                ["GET", "/bom/v1/assays/{publicId}", "Нэг сорьцын дүн, банкны хуваарилалт, revision, audit reference татах."],
                ["POST", "/bom/v1/assays/{publicId}/confirm", "Монголбанк тооцоолол, reference number, confirmation төлөв буцаах."],
                ["GET", "/bom/v1/health", "Connectivity шалгах. Sensitive мэдээлэл буцаахгүй."],
            ],
            [18 * mm, 55 * mm, 84 * mm],
            styles,
        ),
        p("6. Request header", styles["SectionTitle"]),
        table(
            [
                ["Header", "Заавал эсэх", "Тайлбар"],
                ["Authorization", "Тийм", "Bearer token placeholder. Production token зөвхөн secret manager-д хадгална."],
                ["X-Request-Id", "Тийм", "Audit болон trace хийх UUID."],
                ["X-Timestamp", "Тийм", "ISO-8601 UTC timestamp. 5 минутын window-оос хэтэрвэл reject хийнэ."],
                ["X-Signature", "Тийм", "HMAC-SHA256 signature. Method, path, timestamp, body hash дээр тооцно."],
                ["Idempotency-Key", "POST дээр тийм", "Confirmation request давхар орж ирэхээс хамгаална."],
            ],
            [43 * mm, 28 * mm, 86 * mm],
            styles,
        ),
        p("7. Өгөгдлийн үндсэн талбарууд", styles["SectionTitle"]),
        table(
            [
                ["Талбар", "Төрөл", "Тайлбар"],
                ["publicId", "string", "Сорьцын төвөөс үүссэн public дугаар. Жишээ: AC-260829-001."],
                ["assayCenter", "object", "Сорьцын төвийн код, нэр, төрөл."],
                ["customer", "object", "Харилцагчийн төрөл, нэр, регистр/ID masking policy-ийн дагуу."],
                ["metalType", "enum", "gold эсвэл silver."],
                ["grossWeightGram", "decimal", "Нийт жин граммаар."],
                ["purityPercent", "decimal", "Сорьцын хувь. Жишээ: 89.7200."],
                ["fineWeightGram", "decimal", "Цэвэр жин. grossWeightGram * purityPercent / 100."],
                ["allocations", "array", "BOM эсвэл арилжааны банк тус бүрт хуваарилсан грамм."],
                ["approvedAt", "datetime", "Эрхлэгч баталгаажуулсан хугацаа."],
                ["revisionNo", "integer", "Дүнгийн хувилбар. Засвар бүр шинэ revision."],
                ["recordHash", "string", "Tamper-check хийх canonical record hash."],
            ],
            [43 * mm, 30 * mm, 84 * mm],
            styles,
        ),
        PageBreak(),
        p("8. JSON жишээ", styles["SectionTitle"]),
        Preformatted(
            """{
  "publicId": "AC-260829-001",
  "status": "approved",
  "assayCenter": { "code": "PMAC", "name": "Private assay center" },
  "customer": { "type": "organization", "name": "Example LLC" },
  "metalType": "gold",
  "grossWeightGram": "126.4500",
  "purityPercent": "89.7200",
  "fineWeightGram": "113.4599",
  "allocations": [
    { "receiverType": "bom", "receiverName": "Монголбанк", "weightGram": "56.4599" },
    { "receiverType": "commercial_bank", "receiverName": "Хаан банк", "weightGram": "70.0000" }
  ],
  "approvedAt": "2026-08-29T14:30:00Z",
  "revisionNo": 1,
  "recordHash": "sha256:..."
}""",
            styles["CodeMN"],
        ),
        p("9. Error response", styles["SectionTitle"]),
        table(
            [
                ["HTTP", "code", "Тайлбар"],
                ["400", "invalid_request", "Filter, date, decimal format буруу."],
                ["401", "unauthorized", "Token байхгүй эсвэл буруу."],
                ["403", "forbidden", "IP allowlist, role, signature policy зөрчсөн."],
                ["404", "not_found", "publicId олдохгүй эсвэл тухайн integration-д харагдах эрхгүй."],
                ["409", "state_conflict", "Баталгаажаагүй сорьц эсвэл idempotency conflict."],
                ["429", "rate_limited", "Хэт олон хүсэлт илгээсэн."],
                ["500", "internal_error", "Дотоод серверийн алдаа. X-Request-Id-аар шалгана."],
            ],
            [20 * mm, 42 * mm, 95 * mm],
            styles,
        ),
        p("10. Нэвтрүүлэх checklist", styles["SectionTitle"]),
        table(
            [
                ["#", "Шалгах зүйл"],
                ["0", "Үнэ болон төлбөрийн тооцооллыг гаднаас шууд өөрчлөх боломж олгохгүй. Confirmation нь тусдаа бичилт байна."],
                ["1", "Production endpoint, staging endpoint, contact window-г тусдаа баталгаажуулах."],
                ["2", "Монголбанк талын outbound IP allowlist авах."],
                ["3", "API token, signing secret-ийг password manager/secret manager-аар дамжуулах."],
                ["4", "Signature verification болон replay protection дээр хамтарсан integration test хийх."],
                ["5", "Maker-checker баталгаажсан сорьц л API дээр гарахыг test case-аар батлах."],
                ["6", "Audit log дээр request id, actor, source IP, status, hash хадгалагдаж байгааг шалгах."],
                ["7", "Алдаа, retry, idempotency behavior-ийг Монголбанк талтай тохиролцох."],
                ["8", "Production go-live өмнө backup, incident response, key rotation procedure батлах."],
            ],
            [14 * mm, 143 * mm],
            styles,
        ),
    ]

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


if __name__ == "__main__":
    build_document()
    print(OUTPUT_PATH)
