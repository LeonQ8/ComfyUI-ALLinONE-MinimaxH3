import os
import shutil
import sys
import time

CODES = {"title": "96", "step": "96", "ok": "92", "warn": "93", "error": "91", "dim": "90", "bar": "92"}
_enabled = False


def enable_colors(stream=None):
    global _enabled
    stream = stream or sys.stdout
    if os.environ.get("NO_COLOR") or not stream.isatty():
        return False
    if sys.platform == "win32":
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        if not kernel32.SetConsoleMode(handle, mode.value | 0x0004):
            return False
    _enabled = True
    return True


def paint(text, kind):
    return f"\033[{CODES[kind]}m{text}\033[0m" if _enabled else text


def size(n):
    if n >= 1 << 30:
        return f"{n / (1 << 30):.2f} GB"
    return f"{n / (1 << 20):.1f} MB"


def duration(seconds):
    seconds = int(seconds)
    minutes, secs = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    if minutes:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


def progress_text(label, done, total, elapsed, bar_width=20, with_speed=True):
    speed = done / elapsed if elapsed > 0 else 0
    rate = f"  {size(speed)}/s" if with_speed else ""
    name = f"{label[:26]:<26}"
    if total:
        ratio = min(done / total, 1.0)
        filled = int(ratio * bar_width)
        eta = duration((total - done) / speed) if speed else "--"
        bar = "#" * filled + "-" * (bar_width - filled)
        return name, bar, f" {ratio * 100:3.0f}%  {size(done)} / {size(total)}{rate}  ETA {eta}"
    return name, "", f"  {size(done)}{rate}"


class Progress:
    def __init__(self, stream=None, interval=0.2):
        self.stream = stream or sys.stdout
        self.interval = interval
        self.live = self.stream.isatty()

    def start(self, label, total):
        self.label, self.total, self.done = label, total, 0
        self.began = self.last = time.monotonic()
        self.width = 0
        if self.live:
            self._draw(self.began)

    def advance(self, amount):
        self.done += amount
        now = time.monotonic()
        if self.live and now - self.last >= self.interval:
            self.last = now
            self._draw(now)

    def finish(self):
        elapsed = time.monotonic() - self.began
        line = f"  {self.label[:26]:<26}  {size(self.done)} in {duration(elapsed)}"
        if self.live:
            self.stream.write("\r" + " " * self.width + "\r")
        self.stream.write(paint(line, "dim") + "\n")
        self.stream.flush()

    def _draw(self, now):
        columns = shutil.get_terminal_size((100, 20)).columns - 1
        for bar_width, with_speed in ((20, True), (20, False), (10, False)):
            name, bar, tail = progress_text(self.label, self.done, self.total, now - self.began, bar_width, with_speed)
            plain = f"  {name} " + (f"[{bar}]" if bar else "") + tail
            if len(plain) <= columns:
                break
        if len(plain) <= columns:
            shown = f"  {name} " + (f"[{paint(bar, 'bar')}]" if bar else "") + tail
        else:
            plain = shown = plain[:columns]
        pad = " " * max(0, self.width - len(plain))
        self.width = len(plain)
        self.stream.write("\r" + shown + pad)
        self.stream.flush()
