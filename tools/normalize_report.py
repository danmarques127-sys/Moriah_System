#!/usr/bin/env python3
"""Normalize municipal CSV/XLSX/PDF tables without AI. Never certifies completeness."""
import argparse, csv, datetime as dt, json, pathlib, re, sys
def rows(path):
    ext=path.suffix.lower()
    if ext==".csv":
        with path.open(encoding="utf-8-sig",newline="") as fp:
            yield from csv.DictReader(fp)
    elif ext==".xlsx":
        import openpyxl
        book=openpyxl.load_workbook(path,read_only=True,data_only=True)
        for sheet in book:
            values=iter(sheet.values)
            headers=[str(x or "").strip() for x in next(values,[])]
            for row in values:
                yield dict(zip(headers,row))
        book.close()
    elif ext==".pdf":
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                for table in page.extract_tables():
                    if not table: continue
                    headers=[str(x or "").strip().replace("\n"," ") for x in table[0]]
                    for row in table[1:]:
                        yield dict(zip(headers,row))
    else:
        raise ValueError("Supported inputs: CSV, XLSX, PDF with extractable tables.")
def issued(value):
    if isinstance(value,(dt.datetime,dt.date)): return value.strftime("%Y-%m-%d")
    text=str(value or "").strip()
    if not text: return ""
    if re.match(r"^\d{4}-\d{2}-\d{2}",text): return dt.date.fromisoformat(text[:10]).isoformat()
    for form in ("%m/%d/%Y","%m/%d/%y","%m-%d-%Y"):
        try: return dt.datetime.strptime(text.split()[0],form).date().isoformat()
        except ValueError: pass
    raise ValueError("Unrecognized issue date: "+text)
def normalize(path,config,month):
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])",month): raise ValueError("Invalid month.")
    source=config["source"]; mapping=config["columns"]
    for name in ("number","issued","address","description","type"):
        if name not in mapping: raise ValueError("Column mapping missing: "+name)
    result={};read=skipped=0
    for raw in rows(path):
        read+=1
        if not all(str(raw.get(k,"") or "").strip()==str(v) for k,v in config.get("include",{}).items()):
            skipped+=1;continue
        get=lambda field:str(raw.get(mapping.get(field,""),"") or "").strip()
        value=raw.get(mapping["issued"])
        if str(value or "").strip()==mapping["issued"]: skipped+=1;continue
        date=issued(value)
        if not date or not date.startswith(month): skipped+=1;continue
        number=get("number")
        if not number: raise ValueError("Issued row has no municipal permit number.")
        cost=get("value").replace("$","").replace(",","") or "0"
        record={"id":source["id"]+":"+number,"sourceId":source["id"],"city":source["city"],"state":source["state"],"number":number,"issued":date,"address":get("address"),"description":get("description") or "Descrição não disponibilizada na fonte; revisar escopo.","type":get("type"),"value":float(cost),"status":get("status"),"contractor":get("contractor"),"applicant":get("applicant"),"sourceUrl":source["documentUrl"]}
        for field in ("phone","email"):
            if get(field): record[field]=get(field)
        if record["id"] in result and result[record["id"]]!=record: raise ValueError("Conflicting duplicate municipal permit: "+number)
        result[record["id"]]=record
    if not read: raise ValueError("No extractable table rows. This PDF needs a layout-specific parser or manual export.")
    return {"sourceId":source["id"],"month":month,"records":list(result.values()),"message":"Deterministic extraction; verify full descriptions, row counts and all pages before using. Read "+str(read)+" rows; excluded "+str(skipped)+" outside criteria/period."}
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("input",type=pathlib.Path);p.add_argument("--config",required=True,type=pathlib.Path);p.add_argument("--month",required=True);p.add_argument("--out",required=True,type=pathlib.Path);a=p.parse_args()
    try:
        result=normalize(a.input,json.loads(a.config.read_text()),a.month)
        a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
        print(str(len(result["records"]))+" normalized records. Coverage is not automatically certified.")
    except Exception as exc:
        print("Extraction failed: "+str(exc),file=sys.stderr);sys.exit(1)
