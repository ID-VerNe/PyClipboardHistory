import re
import os
import requests

def download_fonts(css_file, output_dir):
    with open(css_file, 'r', encoding='utf-8') as f:
        content = f.read()

    urls = re.findall(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', content)
    
    new_content = content
    
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    downloaded_files = {}

    for url in urls:
        filename = url.split('/')[-1]
        filepath = os.path.join(output_dir, filename)
        
        if filename not in downloaded_files:
            print(f"Downloading {url} to {filepath}...")
            try:
                response = requests.get(url)
                response.raise_for_status()
                with open(filepath, 'wb') as f:
                    f.write(response.content)
                downloaded_files[filename] = True
            except Exception as e:
                print(f"Failed to download {url}: {e}")
                continue
        
        # Update CSS content to point to local file
        new_content = new_content.replace(url, f'fonts/{filename}')

    # Save the updated CSS file
    with open(css_file, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f"Updated {css_file}")

if __name__ == "__main__":
    base_dir = r"c:\Users\VerNe\Downloads\Documents\PyClipboardHistory\frontend"
    download_fonts(os.path.join(base_dir, "css2.css"), os.path.join(base_dir, "fonts"))
    download_fonts(os.path.join(base_dir, "css3.css"), os.path.join(base_dir, "fonts"))
