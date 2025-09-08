
import json
from pathlib import Path
from typing import Optional
import requests
from bs4 import BeautifulSoup, Tag

def find_header(soup: BeautifulSoup, text: str) -> Optional[Tag]:
    """Find a header (h1–h6) whose id/text/span matches the given text."""
    for header in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
        # Match by id
        if header.get("id") == text:
            return header
        # Match by direct text content
        if header.get_text(strip=True) == text:
            return header
        # Match by a nested span
        span = header.find("span", string=text)
        if span:
            return header
    return None


def _count_header_rows(table: Tag) -> int:
    """Count consecutive header rows (rows containing any <th>) at top of the table."""
    header_rows = 0
    tbody = table.find("tbody") or table
    for tr in tbody.find_all("tr", recursive=False):
        if tr.find_all("th"):
            header_rows += 1
        else:
            break
    return header_rows


def _get_col_index_by_header_text(table: Tag, header_text: str) -> Optional[int]:
    """Return logical column index for the given header label, accounting for colspan."""
    tbody = table.find("tbody") or table
    first_header_row = None
    for tr in tbody.find_all("tr", recursive=False):
        if tr.find_all("th"):
            first_header_row = tr
            break
    if not first_header_row:
        return None

    col_idx = 0
    for th in first_header_row.find_all("th", recursive=False):
        text = th.get_text(strip=True)
        colspan = int(th.get("colspan", 1))
        if text == header_text:
            return col_idx
        col_idx += colspan
    return None


def _get_cell_by_logical_index(row: Tag, logical_index: int) -> Optional[Tag]:
    """Get the <td>/<th> cell at a logical column index, expanding colspans."""
    cells = row.find_all(["td", "th"], recursive=False)
    col = 0
    for cell in cells:
        colspan = int(cell.get("colspan", 1))
        # Fill slots this cell spans
        for _ in range(colspan):
            if col == logical_index:
                return cell
            col += 1
    return None

def scrape_jyutping_table():
    """
    Fetch the live Wikipedia page and extract Jyutping values for:
    - Initials (聲母)
    - Finals (韻母)
    - Tones (聲調: number → tone name)
    Save as JSON to out/jyutping_map.json
    """
    base_dir = Path(__file__).resolve().parent.parent
    output_path = base_dir / "out" / "jyutping_map.json"

    # Fetch online HTML from Wikipedia (粵語拼音對照表)
    url = "https://zh-yue.wikipedia.org/wiki/%E7%B2%B5%E8%AA%9E%E6%8B%BC%E9%9F%B3%E5%B0%8D%E7%85%A7%E8%A1%A8"
    print(f"Fetching online page: {url} ...")
    headers = {
        "User-Agent": "canton-lyr-crawler/1.0 (+https://example.com)",
        "Accept-Language": "yue, zh-Hant;q=0.9, zh;q=0.8, en;q=0.7",
    }
    resp = requests.get(url, headers=headers, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.encoding or "utf-8"
    soup = BeautifulSoup(resp.text, "lxml")
    print("Parsed HTML. Extracting tables…")

    result = {
        "consonants": [],  # 聲母（粵拼）
        "rhymes": [],       # 韻母（粵拼）
        "tones": {},        # 粵拼數字 → 調名
    }

    # --- Initials (聲母) ---
    consonants_header = find_header(soup, "聲母")
    if consonants_header:
        header_container = consonants_header.parent or consonants_header
        table = header_container.find_next_sibling("table")
        if table:
            col_idx = _get_col_index_by_header_text(table, "粵拼")
            header_rows = _count_header_rows(table)
            print(f"Initials: Jyutping column={col_idx}, header rows={header_rows}")
            if col_idx is not None:
                values = set()
                tbody = table.find("tbody") or table
                rows = tbody.find_all("tr", recursive=False)[header_rows:]
                for tr in rows:
                    cell = _get_cell_by_logical_index(tr, col_idx)
                    if not cell:
                        continue
                    text = cell.get_text(strip=True)
                    if not text:
                        continue
                    for part in text.replace("／", "/").split("/"):
                        part = part.strip()
                        if part:
                            values.add(part)
                result["consonants"] = sorted(values)
                print(f"Initials: extracted {len(values)} unique Jyutping initials")
        else:
            print("Initials: table not found")
    else:
        print("Initials: header not found")

    # --- Finals (韻母) ---
    rhymes_header = find_header(soup, "韻母")
    if rhymes_header:
        header_container = rhymes_header.parent or rhymes_header
        table = header_container.find_next_sibling("table")
        if table:
            col_idx = _get_col_index_by_header_text(table, "粵拼")
            header_rows = _count_header_rows(table)
            print(f"Finals: Jyutping column={col_idx}, header rows={header_rows}")
            if col_idx is not None:
                values = set()
                tbody = table.find("tbody") or table
                rows = tbody.find_all("tr", recursive=False)[header_rows:]
                for tr in rows:
                    cell = _get_cell_by_logical_index(tr, col_idx)
                    if not cell:
                        continue
                    text = cell.get_text(strip=True)
                    if not text:
                        continue
                    for part in text.replace("／", "/").split("/"):
                        part = part.strip()
                        if part:
                            values.add(part)
                result["rhymes"] = sorted(values)
                print(f"Finals: extracted {len(values)} unique Jyutping finals")
        else:
            print("Finals: table not found")
    else:
        print("Finals: header not found")

    # --- Tones (聲調) ---
    tones_header = find_header(soup, "聲調")
    if tones_header:
        header_container = tones_header.parent or tones_header
        table = header_container.find_next_sibling("table")
        if table:
            jp_idx = _get_col_index_by_header_text(table, "粵拼")
            name_idx = _get_col_index_by_header_text(table, "調名、音值")
            header_rows = _count_header_rows(table)
            print(f"Tones: Jyutping column={jp_idx}, name column={name_idx}, header rows={header_rows}")
            if jp_idx is not None and name_idx is not None:
                tbody = table.find("tbody") or table
                rows = tbody.find_all("tr", recursive=False)[header_rows:]
                for tr in rows:
                    name_cell = _get_cell_by_logical_index(tr, name_idx)
                    jp_cell = _get_cell_by_logical_index(tr, jp_idx)
                    if not name_cell or not jp_cell:
                        continue
                    raw_name = name_cell.get_text(strip=True)
                    tone_name = raw_name.split("，")[0].strip() if raw_name else ""
                    raw_jp = jp_cell.get_text(strip=True)
                    if not tone_name or not raw_jp:
                        continue
                    # Split variants like "7或1"
                    for token in raw_jp.replace("／", "/").split("或"):
                        token = token.strip()
                        if token.isdigit() and token not in result["tones"]:
                            # Prefer the first conventional mapping encountered
                            result["tones"][token] = tone_name
                print(f"Tones: extracted {len(result['tones'])} mappings")
        else:
            print("Tones: table not found")
    else:
        print("Tones: header not found")

    # --- Save ---
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote output to {output_path}")

if __name__ == '__main__':
    scrape_jyutping_table()
