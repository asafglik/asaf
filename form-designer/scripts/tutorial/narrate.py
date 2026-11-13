# Narration clips (Microsoft neural voice via edge-tts) + their durations:
#   pip install edge-tts && python3 narrate.py
import json, asyncio, os, subprocess
import edge_tts
VOICE = os.environ.get('VOICE', 'he-IL-HilaNeural')
n = json.load(open('narration.json'))
os.makedirs('audio', exist_ok=True)
async def go():
    for k, t in n.items():
        await edge_tts.Communicate(t, VOICE, rate='+4%').save(f'audio/{k}.mp3')
asyncio.run(go())
d = {k: float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'audio/{k}.mp3']).decode()) for k in n}
json.dump(d, open('durations.json', 'w'), indent=1)
print('total', round(sum(d.values())), 's')
