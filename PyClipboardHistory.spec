
# -*- mode: python ; coding: utf-8 -*-

# This is a PyInstaller spec file. For more details, see:
# https://pyinstaller.org/en/stable/spec-files.html

a = Analysis(
    ['py_clipboard_history/main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('py_clipboard_history/storage', 'storage'),
        ('py_clipboard_history/assets', 'assets')
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='PyClipboardHistory',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # Set to False to create a windowed (no-console) app
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='py_clipboard_history/assets/icon.png' # Add the application icon
)
