import os
import json
import sys
from opencc import OpenCC

def convert_text(text, converter):
    """Converts text from Simplified to Traditional Chinese."""
    return converter.convert(text)

def convert_json_object(obj, converter):
    """Recursively converts all string values in a JSON object to Traditional Chinese."""
    if isinstance(obj, dict):
        return {k: convert_json_object(v, converter) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_json_object(elem, converter) for elem in obj]
    elif isinstance(obj, str):
        return convert_text(obj, converter)
    else:
        return obj

def process_jsonl_file(file_path, converter, cleanup=False):
    """Converts a .jsonl file to Traditional Chinese and optionally cleans up the original."""
    directory, filename = os.path.split(file_path)
    new_filename = convert_text(filename.replace('.jsonl', '_traditional.jsonl'), converter)
    new_file_path = os.path.join(directory, new_filename)

    try:
        with open(file_path, 'r', encoding='utf-8') as infile, \
             open(new_file_path, 'w', encoding='utf-8') as outfile:
            for line in infile:
                try:
                    data = json.loads(line)
                    converted_data = convert_json_object(data, converter)
                    outfile.write(json.dumps(converted_data, ensure_ascii=False) + '\n')
                except json.JSONDecodeError:
                    print(f"Skipping invalid JSON line in {file_path}: {line.strip()}")
        print(f"Converted {file_path} to {new_file_path}")

        if cleanup:
            os.remove(file_path)
            print(f"Removed original file: {file_path}")

    except FileNotFoundError:
        print(f"Error: File not found {file_path}. Skipping.")

def convert_filenames_and_content(root_dir, converter, cleanup=False):
    """Walks through a directory, converts .jsonl files and renames files/dirs."""
    # Rename directories from bottom up
    for dirpath, dirnames, filenames in os.walk(root_dir, topdown=False):
        for dirname in dirnames:
            if any('\u4e00' <= char <= '\u9fff' for char in dirname):
                new_dirname = convert_text(dirname, converter)
                if new_dirname != dirname:
                    try:
                        os.rename(os.path.join(dirpath, dirname), os.path.join(dirpath, new_dirname))
                        print(f"Renamed directory {dirname} to {new_dirname}")
                    except OSError as e:
                        print(f"Error renaming directory {dirname}: {e}")

    # Process and rename files
    for dirpath, _, filenames in os.walk(root_dir):
        for filename in filenames:
            original_path = os.path.join(dirpath, filename)
            if filename.endswith('.jsonl') and '_traditional' not in filename:
                process_jsonl_file(original_path, converter, cleanup)
            elif not filename.endswith('.jsonl'):
                if any('\u4e00' <= char <= '\u9fff' for char in filename):
                    new_filename = convert_text(filename, converter)
                    if new_filename != filename:
                        try:
                            os.rename(original_path, os.path.join(dirpath, new_filename))
                            print(f"Renamed file {filename} to {new_filename}")
                        except OSError as e:
                            print(f"Error renaming file {filename}: {e}")

def main():
    """Main function to run the conversion."""
    args = sys.argv[1:]
    if not args or len(args) > 2:
        print("Usage: python convert_to_traditional.py <directory> [--cleanup]")
        sys.exit(1)

    root_dir = args[0]
    cleanup = '--cleanup' in args

    if not os.path.isdir(root_dir):
        print(f"Error: {root_dir} is not a valid directory.")
        sys.exit(1)

    # s2t: Simplified Chinese to Traditional Chinese
    converter = OpenCC('s2t')
    
    print(f"Starting conversion for directory: {root_dir}")
    if cleanup:
        print("Cleanup mode enabled: Original .jsonl files will be removed.")
        
    convert_filenames_and_content(root_dir, converter, cleanup)
    print("Conversion complete.")

if __name__ == "__main__":
    main()