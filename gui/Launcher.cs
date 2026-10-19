using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            if (args.Contains("--self-test"))
            {
                if (Launcher.Quote("a b") != "\"a b\"" || Launcher.Quote("a\"b") != "\"a\\\"b\"" || Launcher.Quote("a\\") != "\"a\\\\\"") return 2;
                Launcher.VerifyRuntime();
                return 0;
            }
            Application.Run(new Launcher(args));
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "无法启动增强插件", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}

internal sealed class Launcher : Form
{
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    private readonly bool removing = false;
    private string userLocal = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    private string userHome = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private string appRoot, stateDir;
    private bool busy, customState, finished;
    private readonly TextBox log = new TextBox();
    private readonly TextBox displayName = new TextBox();
    private readonly CheckBox ultra = new CheckBox();
    private readonly Button primary = new Button(), check = new Button(), admin = new Button(), backups = new Button();
    private readonly Label status = new Label();
    private readonly ProgressBar progress = new ProgressBar();

    internal Launcher(string[] args)
    {
#if UNINSTALL
        removing = true;
#endif
        for (int i = 0; i < args.Length; i++)
        {
            string arg = args[i];
            if (arg == "--ultra") ultra.Checked = true;
            else if (new[] { "--user-local", "--user-home", "--app-root", "--state-dir", "--name" }.Contains(arg))
            {
                if (++i >= args.Length) throw new ArgumentException("启动参数不完整");
                string value = args[i];
                if (arg == "--user-local") userLocal = value;
                if (arg == "--user-home") userHome = value;
                if (arg == "--app-root") appRoot = value;
                if (arg == "--state-dir") { stateDir = value; customState = true; }
                if (arg == "--name") displayName.Text = value;
            }
            else throw new ArgumentException("未知启动参数");
        }
        Text = "Claude Gateway 增强 · " + (removing ? "一键卸载" : "一键安装");
        ClientSize = new Size(680, 550);
        MinimumSize = new Size(696, 589);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Microsoft YaHei UI", 9F);
        BackColor = Color.FromArgb(250, 250, 250);
        AutoScaleMode = AutoScaleMode.Dpi;

        var title = new Label { Text = removing ? "恢复安装前的状态" : "让 Gateway 模式更好用", Font = new Font(Font.FontFamily, 18F, FontStyle.Bold), AutoSize = true, Location = new Point(24, 20) };
        var intro = new Label { Text = "v0.2.0  ·  Windows x64  ·  Claude Desktop 2.42304.0\nMagpie 可选。会话、凭据及其他设置保留。", AutoSize = true, Location = new Point(26, 64) };
        var note = new Label { Text = removing ? "自动查找备份，验证资源后恢复。\n请先保存工作，并从托盘正常退出 Claude。" : "中文、头像、聊天 / 协作、浏览器与文件分析。\n请先保存工作，并从托盘正常退出 Claude。", AutoSize = true, Location = new Point(26, 112) };
        ultra.Text = "同时启用原生 Ultra（仅已验证的模型与引擎）";
        ultra.AutoSize = true; ultra.Location = new Point(26, 162); ultra.Visible = !removing;
        var nameLabel = new Label { Text = "显示名称（可选）", AutoSize = true, Location = new Point(26, 196), Visible = !removing };
        displayName.Location = new Point(244, 191); displayName.Width = 220; displayName.MaxLength = 80; displayName.Visible = !removing;
        status.Text = "正在检查环境…"; status.AutoSize = false; status.Location = new Point(26, 234); status.Size = new Size(628, 28); status.Font = new Font(Font, FontStyle.Bold); status.AccessibleName = "操作状态";
        progress.Location = new Point(26, 268); progress.Size = new Size(628, 5); progress.Style = ProgressBarStyle.Marquee; progress.Visible = false;
        log.Location = new Point(26, 286); log.Size = new Size(628, 156); log.Multiline = true; log.ReadOnly = true; log.ScrollBars = ScrollBars.Vertical; log.BackColor = Color.White; log.AccessibleName = "检查和操作结果";
        primary.Text = removing ? "卸载并恢复原状" : "安装并自动备份"; primary.Location = new Point(26, 462); primary.Size = new Size(180, 40); primary.BackColor = Color.FromArgb(190, 83, 49); primary.ForeColor = Color.White; primary.FlatStyle = FlatStyle.Flat; primary.Enabled = false;
        check.Text = "重新检查"; check.Location = new Point(218, 462); check.Size = new Size(110, 40);
        backups.Text = removing ? "选择备份" : "打开备份目录"; backups.Location = new Point(340, 462); backups.Size = new Size(134, 40);
        admin.Text = "管理员重试"; admin.Location = new Point(486, 462); admin.Size = new Size(168, 40); admin.Visible = false;
        var footer = new Label { Text = "自动备份 · 版本与哈希检查 · 失败自动撤回", AutoSize = true, Location = new Point(26, 520), ForeColor = Color.DimGray };
        Controls.AddRange(new Control[] { title, intro, note, ultra, nameLabel, displayName, status, progress, log, primary, check, backups, admin, footer });
        primary.Click += async delegate { if (finished) Close(); else await Execute(false); };
        check.Click += async delegate { await Execute(true); };
        backups.Click += delegate { OpenBackups(); };
        admin.Click += delegate { RetryAsAdministrator(); };
        Shown += async delegate { await Execute(true); };
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (busy) { e.Cancel = true; MessageBox.Show(this, "正在完成文件事务，请等待结果后再关闭窗口。", "操作进行中"); } };
    }

    internal static string Quote(string value)
    {
        // 按 Windows 参数解析规则转义，不经过 Shell 拼接执行。
        var output = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { output.Append('\\', slashes * 2 + 1); output.Append(c); slashes = 0; continue; }
            output.Append('\\', slashes); slashes = 0; output.Append(c);
        }
        output.Append('\\', slashes * 2); return output.Append('"').ToString();
    }

    internal static void VerifyRuntime()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string executable = Path.Combine(baseDir, "runtime", "node.exe");
        string manifest = Path.Combine(baseDir, "runtime", "manifest.json");
        if (!File.Exists(executable) || !File.Exists(manifest)) throw new FileNotFoundException("运行组件不完整。请下载 Windows x64 完整安装包，并先全部解压；不要只下载两个 EXE 或源码包。");
        var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(manifest));
        using (var sha = SHA256.Create()) using (var input = File.OpenRead(executable))
        {
            string actual = BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "");
            if (!String.Equals(actual, Convert.ToString(data["sha256"]), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("运行组件校验失败，请重新下载完整安装包。");
        }
    }

    private List<string> BackendArguments(bool dryRun)
    {
        var args = new List<string> { Path.Combine(root, "src", "cli.mjs"), dryRun && !removing ? "doctor" : (removing ? "uninstall" : "install"), "--json", "--user-local", userLocal, "--user-home", userHome };
        if (dryRun && removing) args.Add("--dry-run");
        if (!String.IsNullOrEmpty(appRoot)) args.AddRange(new[] { "--app-root", appRoot });
        if (!String.IsNullOrEmpty(stateDir)) args.AddRange(new[] { "--state-dir", stateDir });
        if (!removing && ultra.Checked) args.Add("--ultra");
        if (!removing && !String.IsNullOrWhiteSpace(displayName.Text)) args.AddRange(new[] { "--name", displayName.Text.Trim() });
        return args;
    }

    private async Task Execute(bool dryRun)
    {
        if (busy) return;
        busy = true; primary.Enabled = check.Enabled = backups.Enabled = ultra.Enabled = displayName.Enabled = false; admin.Visible = false; progress.Visible = true;
        status.Text = dryRun ? "正在检查版本和资源…" : (removing ? "正在恢复备份…" : "正在备份并安装…"); status.ForeColor = Color.Black;
        try
        {
            List<string> args = BackendArguments(dryRun);
            var response = await Task.Run(delegate
            {
                VerifyRuntime();
                var info = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"), String.Join(" ", args.Select(Quote))) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
                using (var child = Process.Start(info))
                {
                    Task<string> output = child.StandardOutput.ReadToEndAsync(), errors = child.StandardError.ReadToEndAsync();
                    child.WaitForExit(); Task.WaitAll(output, errors);
                    string content = child.ExitCode == 0 ? output.Result : errors.Result;
                    if (String.IsNullOrWhiteSpace(content)) throw new IOException("安装后端没有返回结果，请检查安装包是否完整。");
                    return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(content.Trim());
                }
            });
            if (!response.ContainsKey("ok") || !Convert.ToBoolean(response["ok"])) throw new IOException(Convert.ToString(response["error"]));
            if (response.ContainsKey("appRoot")) appRoot = Convert.ToString(response["appRoot"]);
            if (response.ContainsKey("stateDir")) stateDir = Convert.ToString(response["stateDir"]);
            string shownBackup = stateDir.StartsWith(userLocal, StringComparison.OrdinalIgnoreCase) ? "%LOCALAPPDATA%" + stateDir.Substring(userLocal.Length) : stateDir;
            log.Text = Convert.ToString(response["message"]) + "\r\n\r\n备份位置：\r\n" + shownBackup;
            bool already = dryRun && !removing && Convert.ToString(response["status"]) == "installed";
            finished = !dryRun || already;
            status.Text = already ? "已经安装，原始备份保留" : dryRun ? "检查通过，可以继续" : removing ? "卸载完成" : "安装完成";
            status.ForeColor = Color.FromArgb(30, 112, 66);
            primary.Text = finished ? "完成" : removing ? "卸载并恢复原状" : "安装并自动备份";
            primary.Enabled = true;
        }
        catch (Exception error)
        {
            status.Text = "操作已停止，请查看说明"; status.ForeColor = Color.Firebrick; log.Text = error.Message;
            primary.Enabled = !dryRun;
            if (error.Message.IndexOf("EACCES", StringComparison.OrdinalIgnoreCase) >= 0 || error.Message.IndexOf("EPERM", StringComparison.OrdinalIgnoreCase) >= 0 || error.Message.Contains("拒绝访问"))
            { admin.Visible = true; log.AppendText("\r\n\r\n可点击“管理员重试”请求 Windows 授权。工具不会修改文件所有权或 ACL；若保护仍然拒绝写入，会停止并保留恢复记录。"); }
            if (!customState && !String.IsNullOrEmpty(stateDir))
            {
                string file = Path.Combine(stateDir, "install.json");
                if (File.Exists(file)) try { var state = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(file)); if (Convert.ToString(state["status"]) == "rolled-back") stateDir = null; } catch { }
            }
        }
        finally { busy = false; progress.Visible = false; check.Enabled = backups.Enabled = true; ultra.Enabled = displayName.Enabled = !finished; }
    }

    private async void OpenBackups()
    {
        if (removing)
        {
            using (var chooser = new FolderBrowserDialog { Description = "选择包含 install.json 的原始备份文件夹" })
            {
                if (chooser.ShowDialog(this) != DialogResult.OK) return;
                if (!File.Exists(Path.Combine(chooser.SelectedPath, "install.json"))) { MessageBox.Show(this, "这个文件夹没有安装备份记录。"); return; }
                stateDir = chooser.SelectedPath; customState = true; finished = false; await Execute(true);
            }
        }
        else
        {
            string folder = !String.IsNullOrEmpty(stateDir) && Directory.Exists(stateDir) ? stateDir : Path.Combine(userLocal, "ClaudeGatewayEnhancer");
            if (Directory.Exists(folder)) Process.Start(new ProcessStartInfo("explorer.exe", Quote(folder)) { UseShellExecute = true });
            else MessageBox.Show(this, "安装时会自动创建备份目录，目前尚未写入备份。");
        }
    }

    private void RetryAsAdministrator()
    {
        if (MessageBox.Show(this, "将请求 Windows 管理员授权，并继续使用原用户的配置与备份目录。授权后仍需在新窗口点击执行。", "管理员重试", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return;
        var args = new List<string> { "--user-local", userLocal, "--user-home", userHome };
        if (!String.IsNullOrEmpty(appRoot)) args.AddRange(new[] { "--app-root", appRoot });
        if (!String.IsNullOrEmpty(stateDir)) args.AddRange(new[] { "--state-dir", stateDir });
        if (!String.IsNullOrWhiteSpace(displayName.Text)) args.AddRange(new[] { "--name", displayName.Text });
        if (ultra.Checked) args.Add("--ultra");
        try { Process.Start(new ProcessStartInfo(Application.ExecutablePath, String.Join(" ", args.Select(Quote))) { UseShellExecute = true, Verb = "runas" }); Close(); }
        catch (Win32Exception) { log.AppendText("\r\n管理员授权未完成，当前窗口与备份保留。"); }
    }
}
