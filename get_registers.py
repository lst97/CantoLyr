import json

registers = set()
pos_values = set()
files = ['data/preprocess/lexicon/chars.posr.jsonl', 'data/preprocess/lexicon/vocab.posr.jsonl']

for file_path in files:
    print(f"\n{file_path}:")
    file_registers = set()
    file_pos = set()
    with open(file_path, 'r') as f:
        for line in f:
            data = json.loads(line)
            for reading in data.get('readings', []):
                if 'register' in reading:
                    file_registers.add(reading['register'])
                    registers.add(reading['register'])
                if 'pos' in reading:
                    file_pos.add(reading['pos'])
                    pos_values.add(reading['pos'])
    print(f"Registers: {sorted(file_registers)}")
    print(f"POS: {sorted(file_pos)}")

print(f"\nAll unique registers: {sorted(registers)}")
print(f"All unique POS: {sorted(pos_values)}")
