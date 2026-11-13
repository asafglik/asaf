# Assemble: video + narration clips at their scene marks + soft background music (ducked under the voice)
import json, subprocess, glob, sys
marks = json.load(open('marks.json'))
video = glob.glob('raw/*.webm')[0]
dur = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',video]).decode())
keys = sorted(marks)
inputs = ['-i', video, '-i', 'music.m4a']
for k in keys: inputs += ['-i', f'audio/{k}.mp3']
OFFSET = 250  # ms: the recording starts slightly before the first mark is taken
f = []
for i, k in enumerate(keys):
    d = max(0, int(marks[k] + OFFSET))
    f.append(f'[{i+2}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={d}|{d},volume=1.6[v{i}]')
f.append(''.join(f'[v{i}]' for i in range(len(keys))) + f'amix=inputs={len(keys)}:normalize=0:duration=longest[voice]')
f.append('[voice]asplit=2[voice1][vsc]')
f.append(f'[1:a]atrim=0:{dur:.2f},volume=0.55,afade=t=in:d=2,afade=t=out:st={dur-4:.2f}:d=4[mus]')
# music dips further while the narrator speaks
f.append('[mus][vsc]sidechaincompress=threshold=0.02:ratio=4:attack=80:release=600[duck]')
f.append('[voice1][duck]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[aout]')
out = sys.argv[1] if len(sys.argv) > 1 else 'out.mp4'
cmd = ['ffmpeg','-v','error','-y',*inputs,'-filter_complex',';'.join(f),'-map','0:v','-map','[aout]',
       '-c:v','libx264','-preset','slow','-crf','22','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','160k','-movflags','+faststart','-t',f'{dur:.2f}',out]
subprocess.check_call(cmd)
print('ok', out, dur)
