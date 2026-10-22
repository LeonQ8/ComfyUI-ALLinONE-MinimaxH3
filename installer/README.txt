One Node MiniMax H3 - Windows installer (beta)
==============================================

You need: Windows 10 or 11, an NVIDIA RTX 40 series card,
about 10 GB of free disk space and an internet connection.

This installer is in beta. Please report any issues you get (link at
the bottom). We may support more cards in the future based on your reports.


INSTALL

1. Put install.bat in a new, empty folder, for example C:\MiniMax.
   Do not use Program Files or a folder that needs admin rights.
2. Double-click install.bat.
   It downloads about 6 GB. This can take 20 minutes or more.
3. Wait until it says "Install finished", then press any key.


START

Double-click Run-MiniMax-ALLinONE.bat.
ComfyUI opens in your browser. If it does not, go to http://127.0.0.1:8188
Keep the black window open while you use it. Close it to stop ComfyUI.


MODELS

Models are not included. Download them from the list here:
https://github.com/LeonQ8/ComfyUI-ALLinONE-MinimaxH3/blob/main/requirements/REQUIREMENTS.md


UPDATE

Double-click update.bat to get the latest tested version of everything.
Run it when a new version is announced, or if an install was stopped.
Close ComfyUI first. It only downloads what changed.
Your models, outputs and settings are kept.
Replaced files are saved in the backups folder.
To see which versions you have, open installer\STACK.md in this folder.


WHAT THE INSTALLER DOES

It downloads only from python.org, PyPI, download.pytorch.org and GitHub.
Every version is pinned. The full list is in installer\STACK.md.
Python, pip and the other direct downloads are checked against known checksums.
It needs no admin rights and changes no Windows settings.
It adds no services or startup items and collects no data.
Everything is saved in this folder. Windows' temp folder is used while it works.
The pip_cache folder holds downloaded packages. You can delete it to free space.
To uninstall, delete this folder.


PROBLEMS

Read the red message in the window.
If the install stopped, run update.bat to continue from where it stopped.
Report problems here: https://github.com/LeonQ8/ComfyUI-ALLinONE-MinimaxH3/issues
