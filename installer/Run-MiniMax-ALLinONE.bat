@echo off
cd /d "%~dp0"
.\python_embeded\python.exe -I -X utf8 -W ignore::FutureWarning ComfyUI\main.py --windows-standalone-build --use-sage-attention
pause
