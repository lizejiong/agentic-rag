"""Generate the Chinese multi-format fixture corpus for the evaluation space."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from docx import Document
from docx.shared import Pt
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches, Pt as SlidePt
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas


FIXTURES = {
    "employee-handbook.docx": ("员工手册", "试用期为三个月，转正需完成直属主管评估。"),
    "travel-policy-2025.docx": ("差旅管理制度（2025版）", "国内出差的交通、住宿和餐补须在出差结束后十个自然日内报销。"),
    "travel-policy-2024.pdf": ("差旅管理制度（2024版）", "2024版一线城市住宿标准为每晚500元，本制度已于2025年1月1日失效。"),
    "purchase-process.docx": ("采购申请流程", "单笔采购金额超过五万元时，必须由财务负责人和总经理共同审批。"),
    "security-policy.pdf": ("信息安全管理制度", "客户数据禁止通过个人网盘、私人邮箱或未授权即时通信工具外发。"),
    "data-classification.docx": ("数据分级规范", "客户身份证号码、银行卡号属于三级敏感数据，访问必须经业务负责人批准。"),
    "incident-playbook.docx": ("客户事故应急预案", "P1事故须在15分钟内在应急群通报，并在2小时内向客户发送首次说明。"),
    "project-handover.docx": ("项目交接指南", "交接完成前必须移交代码仓库权限、部署文档、风险清单和客户联系人。"),
    "hiring-guide.docx": ("招聘与内推说明", "员工内推候选人入职满三个月后，推荐人可获得3000元奖励。"),
    "performance-policy.pdf": ("绩效管理办法", "年度绩效等级分为卓越、优秀、达标、待改进四档。"),
    "contract-approval.docx": ("合同审批规范", "合同使用非标准模板或包含自动续费条款时，必须经过法务审核。"),
    "service-sla.pdf": ("云途服务SLA", "专业版服务月度可用性承诺为99.9%，P1工单响应时间不超过30分钟。"),
    "engineering-guide.docx": ("研发协作规范", "生产环境变更必须关联工单，并由非提交人完成代码评审。"),
}


def _set_doc_style(document: Document) -> None:
    style = document.styles["Normal"]
    style.font.name = "Microsoft YaHei"
    style.font.size = Pt(10.5)


def _write_docx(path: Path, title: str, evidence: str) -> None:
    document = Document()
    _set_doc_style(document)
    document.add_heading(title, level=0)
    document.add_heading("适用范围", level=1)
    document.add_paragraph("本文件适用于星桥云途全体正式员工及经批准的合作人员。")
    document.add_heading("核心规则", level=1)
    document.add_paragraph(evidence)
    document.add_heading("执行说明", level=1)
    document.add_paragraph("如本文件与历史版本存在冲突，以文件标题中的最新年度版本为准。")
    document.save(path)


def _register_cjk_font() -> str:
    """Register a CJK TrueType font and return its name.

    Prefers static TTF fonts over variable fonts or TTC collections for
    broader compatibility with PDF consumers (pypdf, docling).
    """
    import platform

    # Order: static TTF → variable TTF → TTC collection
    if platform.system() == "Windows":
        candidates = (
            "C:/Windows/Fonts/Deng.ttf",          # DengXian, shipping static CJK TTF
            "C:/Windows/Fonts/msyh.ttf",
            "C:/Windows/Fonts/simsun.ttf",
            "C:/Windows/Fonts/NotoSansSC-VF.ttf", # variable font — works but less portable
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simsun.ttc",
        )
    elif platform.system() == "Darwin":
        candidates = (
            "/System/Library/Fonts/STHeiti Light.ttc",
            "/System/Library/Fonts/PingFang.ttc",
        )
    else:
        from glob import glob

        candidates = tuple(
            sorted(glob("/usr/share/fonts/**/*.ttf", recursive=True))
            + sorted(glob("/usr/share/fonts/**/*.ttc", recursive=True))
        )

    for path in candidates:
        try:
            pdfmetrics.registerFont(TTFont("CJKFont", path))
            return "CJKFont"
        except Exception:
            continue

    raise RuntimeError(
        "No CJK TrueType font found. Install CJK fonts or set a FONT_PATH env var."
    )


def _write_pdf(path: Path, title: str, evidence: str) -> None:
    # Use TrueType font so that ToUnicode CMap is embedded — text extraction
    # tools (pypdf, docling) depend on it to decode Chinese glyphs back to
    # Unicode.  CID fonts render correctly but lack this mapping.
    _font_name = _register_cjk_font()
    canvas = Canvas(str(path), pagesize=A4)
    canvas.setFont(_font_name, 18)
    canvas.drawString(72, 780, title)
    canvas.setFont(_font_name, 11)
    y = 730
    for paragraph in ("适用范围：星桥云途内部运营使用。", evidence, "解释权归制度发布部门所有。"):
        canvas.drawString(72, y, paragraph)
        y -= 36
    canvas.save()


def _write_xlsx(path: Path, title: str, rows: list[list[object]]) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = title
    for row in rows:
        sheet.append(row)
    for column in sheet.columns:
        sheet.column_dimensions[column[0].column_letter].width = 22
    workbook.save(path)


def _write_pptx(path: Path, title: str, bullets: list[str]) -> None:
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[5])
    title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.6), Inches(11), Inches(0.8))
    title_box.text_frame.text = title
    title_box.text_frame.paragraphs[0].font.size = SlidePt(30)
    body = slide.shapes.add_textbox(Inches(1.0), Inches(1.8), Inches(10), Inches(4.5))
    frame = body.text_frame
    frame.text = bullets[0]
    frame.paragraphs[0].font.size = SlidePt(22)
    for bullet in bullets[1:]:
        paragraph = frame.add_paragraph()
        paragraph.text = bullet
        paragraph.level = 0
        paragraph.font.size = SlidePt(22)
    presentation.save(path)


def generate_fixture_files(output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    for filename, (title, evidence) in FIXTURES.items():
        path = output / filename
        if path.suffix == ".docx":
            _write_docx(path, title, evidence)
        else:
            _write_pdf(path, title, evidence)
    _write_xlsx(output / "expense-standards-2025.xlsx", "费用标准", [
        ["城市级别", "住宿标准", "餐补标准"],
        ["一线城市", "600元/晚", "120元/天"],
        ["其他城市", "400元/晚", "100元/天"],
    ])
    _write_xlsx(output / "on-call-roster.xlsx", "值班安排", [
        ["级别", "首次响应", "升级负责人"],
        ["P1", "15分钟", "技术负责人"],
        ["P2", "1小时", "值班工程师"],
    ])
    _write_xlsx(output / "sales-discount-policy.xlsx", "销售折扣", [
        ["折扣区间", "审批要求"],
        ["九折及以上", "销售总监审批"],
        ["低于九折", "销售副总裁审批"],
    ])
    _write_pptx(output / "product-roadmap-2025.pptx", "2025产品路线图", [
        "Q2：发布团队知识库与权限管理。",
        "Q3：上线智能问答的引用校验能力。",
        "Q4：开放企业数据分析工作台。",
    ])
    _write_pptx(output / "knowledge-guide.pptx", "知识库使用指南", [
        "上传后先确认文档处理状态为“已完成”。",
        "问答时选择需要检索的知识空间。",
        "回答中的引用可定位到原文页码或工作表。",
    ])
    with (output / "organization-directory.csv").open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.writer(stream)
        writer.writerows([["部门", "职责邮箱"], ["财务部", "finance@xingqiao.example"], ["信息安全", "security@xingqiao.example"]])
    with (output / "legacy-codes.tsv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream, delimiter="\t")
        writer.writerows([["系统", "保留期限"], ["旧工单", "三年"], ["临时日志", "三十天"]])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    generate_fixture_files(args.output)
    print(f"Generated {len(list(args.output.iterdir()))} files in {args.output}")


if __name__ == "__main__":
    main()
