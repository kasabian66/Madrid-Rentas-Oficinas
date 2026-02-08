import io
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas

def export_excel_bytes(df):
    import pandas as pd
    bio = io.BytesIO()
    with pd.ExcelWriter(bio, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Resultados")
    return bio.getvalue()

def export_pdf_bytes(df, title="Informe"):
    bio = io.BytesIO()
    c = canvas.Canvas(bio, pagesize=landscape(A4))
    width, height = landscape(A4)

    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, height-40, title)

    c.setFont("Helvetica", 9)
    y = height - 70
    x0 = 40
    col_widths = [140, 170, 55, 60, 70, 70, 85, 75, 75, 85, 85, 85, 85]
    cols = [
        "Edificio", "Ubicación", "Dist (km)", "m²", "Disp.", "€/m²/mes", "Renta €/mes",
        "Com. €/mes", "IBI €/mes", "T1", "T2", "T3", "TOTAL"
    ]
    # Header
    x = x0
    for w, col in zip(col_widths, cols):
        c.drawString(x, y, col)
        x += w
    y -= 14

    max_rows = 25
    for i, row in df.head(max_rows).iterrows():
        x = x0
        vals = [
            str(row.get("building_name",""))[:30],
            str(row.get("location",""))[:38],
            str(row.get("dist_km","N/D"))[:8],
            str(row.get("area_m2","N/D"))[:10],
            str(row.get("available_from","N/D"))[:10],
            str(row.get("rent_eur_m2_month","N/D"))[:10],
            str(row.get("rent_total_eur_month","N/D"))[:12],
            str(row.get("community_eur_month","N/D"))[:12],
            str(row.get("ibi_eur_month","N/D"))[:12],
            str(row.get("total_1_rent_plus_community","N/D"))[:12],
            str(row.get("total_2_rent_plus_ibi","N/D"))[:12],
            str(row.get("total_3_community_plus_ibi","N/D"))[:12],
            str(row.get("total_final","N/D"))[:12],
        ]
        for w, v in zip(col_widths, vals):
            c.drawString(x, y, v)
            x += w
        y -= 12
        if y < 40:
            c.showPage()
            y = height - 40

    c.showPage()
    c.save()
    return bio.getvalue()
