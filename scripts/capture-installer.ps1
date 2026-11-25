$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms, UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class WizardWin {
    public delegate bool WindowProc(IntPtr hwnd, IntPtr p);
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int left, top, right, bottom; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(WindowProc cb, IntPtr p);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, WindowProc cb, IntPtr p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder buffer, int len);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder buffer, int len);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr w, StringBuilder text, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hwnd, out int process);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out Rect rect, int len);
    public static string Title(IntPtr hwnd) { var b=new StringBuilder(256); GetWindowText(hwnd,b,256); return b.ToString(); }
    public static string ControlText(IntPtr hwnd) {
        var b=new StringBuilder(512); IntPtr value;
        SendMessageTimeout(hwnd, 0x000D, (IntPtr)b.Capacity, b, 2, 150, out value);
        return b.Length==0 ? Title(hwnd) : b.ToString();
    }
    public static string Class(IntPtr hwnd) { var b=new StringBuilder(256); GetClassName(hwnd,b,256); return b.ToString(); }
    public static IntPtr[] Visible() {
      var list = new List<IntPtr>();
      EnumWindows((w,p) => { if(IsWindowVisible(w)) list.Add(w); return true; },IntPtr.Zero); return list.ToArray();
    }
    public static IntPtr[] Children(IntPtr root) {
      var list = new List<IntPtr>();
      EnumChildWindows(root,(w,p) => { if(IsWindowVisible(w)) list.Add(w); return true; },IntPtr.Zero); return list.ToArray();
    }
}
'@
$dir = (New-Item -ItemType Directory -Force -Path 'setup-shots').FullName
$setup = (Get-ChildItem -Path setup-check -Filter 'PowerManager-Setup-*-x64.exe' -Recurse | Select-Object -First 1).FullName
if (!$setup) { throw 'Setup not downloaded' }

function Wait-Wizard([bool]$mainOnly=$false) {
    for ($i=0; $i -lt 70; $i++) {
        foreach ($w in [WizardWin]::Visible()) {
            $class = [WizardWin]::Class($w)
            $caption = [WizardWin]::Title($w)
            if ($caption -match 'PowerManager' -and (!$mainOnly -or $class -eq 'TWizardForm')) { return $w }
        }
        Start-Sleep -Milliseconds 200
    }
    return [IntPtr]::Zero
}

function Save-Wizard($w, $name) {
    if ($w -eq [IntPtr]::Zero) { throw "No window for $name" }
    $rect = New-Object WizardWin+Rect
    if (![WizardWin]::GetWindowRect($w, [ref]$rect)) { throw 'Window has no rectangle' }
    $width = $rect.right - $rect.left; $height = $rect.bottom - $rect.top
    if ($width -lt 180 -or $height -lt 100 -or $width -gt 2400 -or $height -gt 1700) { throw "Window bounds ${width}x${height}" }
    [void][WizardWin]::SetForegroundWindow($w)
    Start-Sleep -Milliseconds 260
    $b = [Drawing.Bitmap]::new($width,$height)
    $g = [Drawing.Graphics]::FromImage($b)
    try {
        $dc = $g.GetHdc()
        try { $painted = [WizardWin]::PrintWindow($w,$dc,2) } finally { $g.ReleaseHdc($dc) }
        $colors = @( & { for ($x=15;$x -lt $width-10;$x+=19) {for ($y=15;$y -lt $height-10;$y+=19) {$b.GetPixel($x,$y).ToArgb()}} } | Sort-Object -Unique)
        if (!$painted -or $colors.Count -lt 6) {
            $g.CopyFromScreen($rect.left,$rect.top,0,0,[Drawing.Size]::new($width,$height))
            $colors = @( & { for ($x=15;$x -lt $width-10;$x+=19) {for ($y=15;$y -lt $height-10;$y+=19) {$b.GetPixel($x,$y).ToArgb()}} } | Sort-Object -Unique)
            if ($colors.Count -lt 6) { throw "Capture for $name was blank" }
        }
        $b.Save((Join-Path $dir "$name.png"),[Drawing.Imaging.ImageFormat]::Png)
    } finally { $g.Dispose(); $b.Dispose() }
}

function Invoke-Control($w, [string]$pattern) {
    foreach($h in [WizardWin]::Children($w)) {
        $title = ([WizardWin]::ControlText($h)).Replace('&','')
        if ($title -match $pattern) {
            [void][WizardWin]::PostMessage($h, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
            return $true
        }
    }
    try {
        $a=[System.Windows.Automation.AutomationElement]::FromHandle($w)
        $items=$a.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
        foreach($item in $items) {
            if ($item.Current.Name -notmatch $pattern) {continue}
            $method=$null
            if ($item.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$method)) {
                $method.Invoke(); return $true
            }
        }
    } catch { Write-Host $_ }
    return $false
}
function Visible-Labels($w) {
    return (([WizardWin]::Children($w) | ForEach-Object { [WizardWin]::ControlText($_) }) -join ' | ')
}

$root = Start-Process -FilePath $setup -ArgumentList '/LANG=chs /NORESTART' -PassThru
$wizard = [IntPtr]::Zero
try {
    $first = Wait-Wizard
    if ($first -ne [IntPtr]::Zero -and ([WizardWin]::Class($first)) -ne 'TWizardForm') {
        Save-Wizard $first '01-install-scope'
        if (!(Invoke-Control $first '为所有用户安装|^Install for all users')) {
            [void][WizardWin]::PostMessage($first,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
        }
    }
    $wizard = Wait-Wizard $true
    if ($wizard -eq [IntPtr]::Zero) {
        $root = Start-Process -FilePath $setup -ArgumentList '/LANG=chs /ALLUSERS /NORESTART' -PassThru
        $wizard = Wait-Wizard $true
    }
    if ($wizard -eq [IntPtr]::Zero) { throw 'Interactive Setup window not found' }
    $next = '^下一步|^Next'
    if ((Visible-Labels $wizard) -match '欢迎使用|Welcome to') {
        if (!(Invoke-Control $wizard $next)) { throw 'Next missing on Welcome' }
        Start-Sleep -Milliseconds 550
    }
    $pages = @(
       @('02-install-directory','目标位置|目标文件夹|安装在哪|Destination Location'),
       @('03-shortcuts','附加任务|桌面快捷方式|Additional Tasks'),
       @('04-review','准备安装|目标位置|Ready to Install')
    )
    foreach ($page in $pages) {
        Start-Sleep -Milliseconds 520
        $labels = Visible-Labels $wizard
        if ($labels -notmatch $page[1]) { throw "Unexpected wizard state $($page[0]): $labels" }
        Save-Wizard $wizard $page[0]
        if ($page[0] -ne '04-review' -and !(Invoke-Control $wizard $next)) { throw "Next missing after $($page[0])" }
    }
} finally {
    if ($wizard -ne [IntPtr]::Zero) { [void][WizardWin]::PostMessage($wizard,0x0010,[IntPtr]::Zero,[IntPtr]::Zero) }
}
