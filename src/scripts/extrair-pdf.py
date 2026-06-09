import argparse
import csv
import json
import re
from pathlib import Path

try:
    import fitz
except ImportError as exc:
    raise SystemExit("Dependencia ausente: instale com `pip install -r requirements-pdf.txt`.") from exc


PROCESSO_RE = re.compile(r"^\d{9}$")
HEADER_RE = re.compile(r"^(MARCAS\s+-\s+RPI|Revista da|Propriedade|Industrial|Nº\s+\d+)", re.I)
PAGE_RE = re.compile(r"^\d{1,5}$")
TITULAR_RE = re.compile(r"\s*\[(?P<pais>[A-Z]{2})(?:/(?P<uf>[A-Z]{2}))?\]\s*$")
TITULAR_LOCAL_RE = re.compile(r"\s*\[(?P<pais>[A-Z]{2})(?:/(?P<uf>[A-Z]{2}))?\]")

SECTION_HEADINGS = {
    "Exigência de pagamento",
    "Exigência formal",
    "Notificação para apresentação de documentação obrigatória de marcas coletivas ou de certificação em designação",
    "Publicação de pedido para oposição",
    "Republicação de pedido para oposição",
    "Notificação de oposição para manifestação",
    "Exame de mérito: Exigência",
    "Exame de mérito de designação: Exigência",
    "Exame de mérito: Sobrestamento",
    "Exame de mérito de designação: Sobrestamento",
    "Exame de mérito: Indeferimento",
    "Exame de mérito de designação: Indeferimento",
    "Exame de mérito: Deferimento",
    "Exame de mérito de designação: Deferimento",
    "Exame de mérito de designação: Deferimento parcial",
    "Em vista da falta de pagamento da retribuição",
    "Em vista da ausência de resposta a exigência de pagamento",
    "Em vista da ausência de resposta a exigência formal",
    "Em vista do cumprimento insatisfatório de exigência formal",
}

LABELS = [
    ("titular", re.compile(r"^Titular(?:\(es\))?:\s*(.*)$", re.I)),
    ("procurador", re.compile(r"^Procurador:\s*(.*)$", re.I)),
    ("data_deposito", re.compile(r"^Data de depósito:\s*(.*)$", re.I)),
    ("tipo_marca", re.compile(r"^Apresentação:\s*(.*)$", re.I)),
    ("natureza", re.compile(r"^Natureza:\s*(.*)$", re.I)),
    ("nome_marca", re.compile(r"^Elemento nominativo:\s*(.*)$", re.I)),
    ("classe_vienna", re.compile(r"^CFE:\s*(.*)$", re.I)),
    ("classe_nice", re.compile(r"^NCL\(\d+\):\s*(.*)$", re.I)),
    ("especificacao", re.compile(r"^Especificação:\s*(.*)$", re.I)),
    ("despacho_complemento", re.compile(r"^Detalhes do despacho:\s*(.*)$", re.I)),
]


def limpar_texto(valor):
    if not valor:
        return None
    valor = re.sub(r"\s+", " ", valor).strip()
    return valor or None


def parse_date(valor):
    valor = limpar_texto(valor)
    if not valor:
        return None
    match = re.search(r"(\d{2})/(\d{2})/(\d{4})", valor)
    if not match:
        return None
    dia, mes, ano = match.groups()
    return f"{ano}-{mes}-{dia}"


def split_nice(valor):
    valor = valor or ""
    return re.findall(r"\d{1,2}", valor)


def split_vienna(valor):
    valor = (valor or "").replace(" e ", ", ")
    return re.findall(r"\d+(?:\.\d+)+", valor)


def parse_titular(valor):
    valor = limpar_texto(valor)
    if not valor:
        return None, None, None
    matches = list(TITULAR_LOCAL_RE.finditer(valor))
    if not matches:
        return valor, None, None
    first = matches[0]
    titular = TITULAR_LOCAL_RE.sub("", valor)
    titular = limpar_texto(re.sub(r"\s+,", ",", titular))
    return titular, first.group("pais"), first.group("uf")


def linha_util(line):
    line = line.strip()
    if not line:
        return None
    if HEADER_RE.search(line):
        return None
    if PAGE_RE.match(line):
        return None
    return line


def extrair_linhas(pdf_path, max_pages=None):
    doc = fitz.open(pdf_path)
    total = doc.page_count if max_pages is None else min(max_pages, doc.page_count)
    for page_index in range(total):
        text = doc.load_page(page_index).get_text("text")
        for raw in text.splitlines():
            line = linha_util(raw)
            if line:
                yield page_index + 1, line
    doc.close()


def coletar_campos(lines):
    fields = {}
    current = None
    current_nice = None
    nice_codes = []
    specs = {}

    for line in lines:
        found = False
        for key, pattern in LABELS:
            match = pattern.match(line)
            if not match:
                continue

            value = match.group(1).strip()
            found = True
            current = key

            if key == "classe_nice":
                codes = split_nice(value)
                for code in codes:
                    if code not in nice_codes:
                        nice_codes.append(code)
                current_nice = codes[-1] if codes else current_nice
                fields.setdefault(key, [])
                fields[key].append(value)
            elif key == "especificacao":
                if current_nice:
                    specs[current_nice] = limpar_texto(value) or ""
                fields[key] = value
            elif key == "classe_vienna":
                fields[key] = value
            else:
                fields[key] = value
            break

        if found:
            continue

        if current == "classe_nice":
            fields.setdefault(current, [])
            fields[current].append(line)
        elif current == "especificacao":
            if current_nice:
                specs[current_nice] = limpar_texto(f"{specs.get(current_nice, '')} {line}") or ""
            fields[current] = f"{fields.get(current, '')} {line}".strip()
        elif current:
            fields[current] = f"{fields.get(current, '')} {line}".strip()

    if nice_codes:
        fields["classe_nice_codes"] = nice_codes
    if specs:
        fields["especificacao_nice"] = {k: limpar_texto(v) for k, v in specs.items() if limpar_texto(v)}
    return fields


def parse_record(processo, status, block_lines, page, numero_revista):
    fields = coletar_campos(block_lines)
    titular, pais, uf = parse_titular(fields.get("titular"))
    classe_nice = fields.get("classe_nice_codes") or []
    especificacao_nice = fields.get("especificacao_nice") or {}

    record = {
        "numero_processo": processo,
        "nome_marca": limpar_texto(fields.get("nome_marca")),
        "titular": titular,
        "pais": pais,
        "uf": uf,
        "classe_nice": classe_nice,
        "especificacao_nice": especificacao_nice,
        "classe_vienna": split_vienna(fields.get("classe_vienna")),
        "status": limpar_texto(status),
        "despacho_codigo": None,
        "despacho_complemento": limpar_texto(fields.get("despacho_complemento")),
        "inpi_cod_pedido": None,
        "sobrestadores": None,
        "data_deposito": parse_date(fields.get("data_deposito")),
        "data_concessao": None,
        "data_vigencia": None,
        "tipo_marca": limpar_texto(fields.get("tipo_marca")),
        "natureza": limpar_texto(fields.get("natureza")),
        "procurador": limpar_texto(fields.get("procurador")),
        "numero_revista": numero_revista,
        "pagina_pdf": page,
    }
    return record


def extrair_registros(pdf_path, numero_revista, max_pages=None):
    current = None
    records = []

    def flush():
        if not current:
            return
        record = parse_record(
            current["processo"],
            current["status"],
            current["lines"],
            current["page"],
            numero_revista,
        )
        records.append(record)

    pending_process = None
    pending_page = None

    for page, line in extrair_linhas(pdf_path, max_pages=max_pages):
        if PROCESSO_RE.match(line):
            flush()
            pending_process = line
            pending_page = page
            current = None
            continue

        if pending_process and current is None:
            current = {
                "processo": pending_process,
                "status": line,
                "lines": [],
                "page": pending_page,
            }
            pending_process = None
            pending_page = None
            continue

        if current and line in SECTION_HEADINGS:
            flush()
            current = None
            continue

        if current:
            current["lines"].append(line)

    flush()
    return records


def escrever_jsonl(records, output_path):
    with output_path.open("w", encoding="utf-8", newline="\n") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def escrever_csv(records, output_path):
    fieldnames = [
        "numero_processo",
        "nome_marca",
        "titular",
        "pais",
        "uf",
        "classe_nice",
        "classe_vienna",
        "status",
        "despacho_complemento",
        "data_deposito",
        "tipo_marca",
        "natureza",
        "procurador",
        "numero_revista",
        "pagina_pdf",
    ]
    with output_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=";")
        writer.writeheader()
        for record in records:
            row = {key: record.get(key) for key in fieldnames}
            row["classe_nice"] = ",".join(record.get("classe_nice") or [])
            row["classe_vienna"] = ",".join(record.get("classe_vienna") or [])
            writer.writerow(row)


def inferir_revista(pdf_path):
    match = re.search(r"(\d{4})", pdf_path.name)
    return int(match.group(1)) if match else None


def main():
    parser = argparse.ArgumentParser(description="Extrai registros de marcas de uma RPI em PDF.")
    parser.add_argument("pdf", help="Caminho do PDF da revista.")
    parser.add_argument("--revista", type=int, help="Numero da revista.")
    parser.add_argument("--out", help="Arquivo JSONL de saida.")
    parser.add_argument("--csv", dest="csv_path", help="Arquivo CSV opcional.")
    parser.add_argument("--max-pages", type=int, help="Limita a leitura para teste.")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    numero_revista = args.revista or inferir_revista(pdf_path)
    if not numero_revista:
        raise SystemExit("Informe --revista quando o numero nao estiver no nome do PDF.")

    output_path = Path(args.out) if args.out else pdf_path.with_suffix(".jsonl")
    records = extrair_registros(pdf_path, numero_revista, max_pages=args.max_pages)
    escrever_jsonl(records, output_path)

    if args.csv_path:
        escrever_csv(records, Path(args.csv_path))

    print(f"{len(records)} registros extraidos para {output_path}")


if __name__ == "__main__":
    main()
