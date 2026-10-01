import tkinter as tk
import argparse
from tkinter import messagebox
from .gui import App
from .storage import app_data_dir, FileLock, AlreadyRunningError


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--open-browser',action='store_true')
    args=parser.parse_args()
    root=tk.Tk()
    lock=FileLock(app_data_dir()/'app.lock')
    try:
        lock.acquire()
    except AlreadyRunningError as exc:
        root.withdraw(); messagebox.showinfo('이미 실행 중',str(exc)); root.destroy(); return
    try:
        app=App(root,app_data_dir())
        if args.open_browser: app.worker.submit('open')
        root.mainloop()
    finally:
        lock.release()


if __name__=='__main__': main()
