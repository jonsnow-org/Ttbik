"""Reviewed script the model may START (`python3 organize.py`) but never write: moves the files of the current folder into one sub-folder per extension."""
import os
import shutil

for name in sorted(os.listdir(".")):
    if os.path.isfile(name) and "." in name and name != "organize.py":
        ext = name.rsplit(".", 1)[1].lower()
        os.makedirs(ext, exist_ok=True)
        shutil.move(name, os.path.join(ext, name))
        print("moved", name, "->", ext + "/")
