"""No-input protocol check for the installed native host launcher."""
import json
from pathlib import Path
import struct
import subprocess

launcher=Path('.runtime/native-input/host.cmd').resolve()
data=json.dumps({'action':'ping'}).encode()
result=subprocess.run(['cmd.exe','/d','/c',str(launcher)],input=(struct.pack('<I',len(data))+data)*3,
                      capture_output=True,timeout=10,check=True)
offset=0
for _ in range(3):
    size=struct.unpack('<I',result.stdout[offset:offset+4])[0]
    assert json.loads(result.stdout[offset+4:offset+4+size])=={'ok':True,'version':2}
    offset+=size+4
assert len(result.stdout)==offset, 'Unexpected stdout in native messaging frame'
print('Native launcher persistent framing/3 pings OK (no mouse input sent)')
