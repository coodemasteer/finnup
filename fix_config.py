import os
os.makedirs('.streamlit', exist_ok=True)
with open('.streamlit/config.toml', 'wb') as f:
    f.write(b'[server]\naddress = "localhost"\nheadless = true\nenableCORS = false\nenableXsrfProtection = false\n')
raw = open('.streamlit/config.toml', 'rb').read()
print('BOM:', raw[:3] == b'\xef\xbb\xbf')
print(raw.decode())
