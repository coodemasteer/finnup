import re
content = open('generate_iim_submission_ppt.py', encoding='utf-8').read()
# Find all tuples that look like stat cards (short value, label, color)
pat = r'"([^"]{1,15})",\s*"([^"]*(?:Rate|Lender|Policies|Approval)[^"]*)"'
for m in re.finditer(pat, content):
    pos = content[:m.start()].count('\n') + 1
    print(f'Line ~{pos}: {repr(m.group(0))}')
