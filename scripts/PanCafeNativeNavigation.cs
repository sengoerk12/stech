using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using Accessibility;

public static partial class PanCafeNativeSessions {
    sealed partial class NativeUi {
        static readonly string[] MemberScreens = { "Üyeler", "Üye Yönetimi", "Üye Listesi" };
        static readonly string[] TerminalScreens = { "Genel", "Terminal Görünümü", "Bilgisayarlar", "Terminaller" };
        static readonly string[] MemberCreditActions = {
            "Üye Bakiyesi Düzenle", "Üye Kredisi Yükle", "Bakiye Düzenle", "Bakiyeyi Düzenle", "Kredi Yükle"
        };
        IntPtr creditOwner;
        public string CreditNavigation { get; private set; }
        public string[] CreditScreenLabels { get; private set; }
        public string[] CreditControlTypes() {
            var scope = creditDialog != IntPtr.Zero ? creditDialog : creditOwner == IntPtr.Zero ? main : creditOwner;
            var classes = new HashSet<string>();
            foreach (var control in Children(scope)) {
                var name = Class(control);
                if (name.Contains("Grid") || name.Contains("List") || name.Contains("Edit") ||
                    name.Contains("Combo") || name.Contains("Button") || name.Contains("Tab") || name.Contains("Radio"))
                    classes.Add(name);
                if (classes.Count >= 24) break;
            }
            var result = new string[classes.Count];
            classes.CopyTo(result);
            Array.Sort(result, StringComparer.Ordinal);
            return result;
        }

        public void OpenTerminalScreen(string terminal) {
            var memberWindow = MemberWindow();
            if (memberWindow != IntPtr.Zero) {
                PostMessage(memberWindow, 0x10, IntPtr.Zero, IntPtr.Zero);
                for (int attempt = 0; attempt < 20 && IsWindowVisible(memberWindow); attempt++) Thread.Sleep(100);
                CheckIdle();
            }
            int row;
            if (FindRow(main, terminal, false, out list, out row)) return;
            foreach (var screen in TerminalScreens) {
                if (!ClickNamed(main, new[] { screen })) continue;
                if (WaitForRow(main, terminal, false, out list, out row)) return;
            }
            if (ClickNavigationIcon(0) && WaitForRow(main, terminal, false, out list, out row)) return;
            throw new InvalidOperationException("PanCafe terminal ekranı veya seçilen bilgisayar bulunamadı.");
        }

        public void OpenMemberCredit(string username) {
            IntPtr members = MemberView(), memberList;
            if (members == IntPtr.Zero) {
                CreditNavigation = "header-not-found";
                if (ClickNamed(main, MemberScreens)) members = WaitForMemberView();
                if (members == IntPtr.Zero && ClickMemberToolbar()) members = WaitForMemberView();
                if (members == IntPtr.Zero)
                    throw new InvalidOperationException("PanCafe Üyeler ekranı açılamadı.");
                CreditNavigation = "member-screen-opened";
            }
            creditOwner = members;
            int row;
            if (!WaitForRow(members, username, true, out memberList, out row)) {
                var search = MemberSearchField(members, true);
                if (search == IntPtr.Zero)
                    throw new InvalidOperationException("PanCafe üye arama alanı bulunamadı.");
                CreditNavigation = "member-search";
                memberList = SelectMemberFromSearch(members, search, username);
            } else {
                using (var items = new RemoteList(memberList, processId)) {
                    items.Select(row);
                    Rect bounds = items.Bounds(row);
                    Click(members, memberList, (bounds.Left + bounds.Right) / 2, (bounds.Top + bounds.Bottom) / 2);
                }
            }
            CreditNavigation = "member-row-selected";
            if (ClickNamed(members, MemberCreditActions)) return;
            if (ClickRenderedMemberCredit(members, memberList, username)) return;

            if (!PostMessage(memberList, 0x7B, memberList, new IntPtr(-1)))
                throw new InvalidOperationException("PanCafe üye menüsü açılamadı.");
            creditMenuOpened = true;
            var menu = WaitWindow("TspSkinPopupWindow", IntPtr.Zero);
            if (!ClickNamed(menu, MemberCreditActions))
                throw new InvalidOperationException("Üye menüsünde Bakiye Düzenle komutu bulunamadı.");
        }

        IntPtr MemberView() {
            var popup = MemberWindow();
            if (popup != IntPtr.Zero) return popup;
            if (MemberSearchField(main) != IntPtr.Zero) return main;
            var search = MemberSearchField(main, true);
            if (search == IntPtr.Zero) return IntPtr.Zero;
            var field = BoundsOf(search);
            return Children(main).Exists(h => Class(h) == "TspSkinDBEdit" && BoundsOf(h).Left > field.Right)
                ? main : IntPtr.Zero;
        }

        IntPtr WaitForMemberView() {
            for (int attempt = 0; attempt < 20; attempt++) {
                var view = MemberView();
                if (view != IntPtr.Zero) return view;
                Thread.Sleep(100);
            }
            return IntPtr.Zero;
        }

        static IntPtr MemberSearchField(IntPtr scope, bool allowLayout = false) {
            var controls = Children(scope);
            foreach (var combo in controls) {
                if (!Class(combo).Contains("ComboBox") ||
                    !Matches(Text(combo), new[] { "Kullanıcı Adı" })) continue;
                var criterion = BoundsOf(combo);
                var edits = controls.FindAll(h => {
                    if (!Class(h).EndsWith("Edit", StringComparison.Ordinal) || !IsWindowEnabled(h)) return false;
                    var field = BoundsOf(h);
                    int height = criterion.Bottom - criterion.Top;
                    return field.Right < criterion.Left && Math.Abs(field.Top - criterion.Top) <= height / 2 &&
                        criterion.Left - field.Right <= height * 4;
                });
                if (edits.Count == 1) return edits[0];
            }
            if (!allowLayout) return IntPtr.Zero;

            // The skinned member grid can hide the criterion label from Win32.
            // Only an editable input immediately above the left-hand results grid is used.
            var screen = BoundsOf(scope);
            int screenWidth = screen.Right - screen.Left;
            var candidates = new HashSet<IntPtr>();
            foreach (var grid in controls.FindAll(h => IsMemberGrid(Class(h)))) {
                var results = BoundsOf(grid);
                if (results.Left - screen.Left > screenWidth / 7 || results.Right - screen.Left > screenWidth / 2) continue;
                foreach (var h in controls) {
                    if (!Class(h).EndsWith("Edit", StringComparison.Ordinal) || !IsWindowEnabled(h)) continue;
                    var field = BoundsOf(h);
                    int height = field.Bottom - field.Top;
                    int distance = results.Top - field.Bottom;
                    if (height >= 10 && distance >= 0 && distance <= 3 * height &&
                        field.Left >= results.Left && field.Right <= results.Right &&
                        field.Left - results.Left <= 2 * height && field.Right - field.Left >= height * 3)
                        candidates.Add(h);
                }
            }
            if (candidates.Count == 1) foreach (var candidate in candidates) return candidate;
            return IntPtr.Zero;
        }

        static bool IsMemberGrid(string type) { return type.Contains("Grid") || type.Contains("ListView"); }

        IntPtr SelectMemberFromSearch(IntPtr scope, IntPtr search, string username) {
            var field = BoundsOf(search);
            var grids = Children(scope).FindAll(h => {
                if (!IsMemberGrid(Class(h))) return false;
                var box = BoundsOf(h);
                return box.Left <= field.Left && box.Right >= field.Right &&
                    box.Top >= field.Bottom && box.Top - field.Bottom <= 4 * (field.Bottom - field.Top);
            });
            if (grids.Count != 1) throw new InvalidOperationException("PanCafe üye sonuç tablosu doğrulanamadı.");
            var grid = grids[0];
            SelectUsernameCriterion(scope, field, grid);
            TypeFocused(scope, search, username);
            if (Text(search) != username)
                throw new InvalidOperationException("PanCafe arama kutusuna kullanıcı adı yazılamadı.");
            // A data-bound search may already have selected the member. Never move that selection.
            if (WaitForMemberCard(scope, grid, username)) return grid;

            var results = AsRectangle(BoundsOf(grid));
            results.Height = Math.Min(results.Height, 520);
            var match = FindScreenText(results, username);
            if (!match.IsEmpty && ClickScreenText(scope, grid, match) && WaitForMemberCard(scope, grid, username))
                return grid;
            throw new InvalidOperationException("PanCafe araması istenen üye kartını doğrulamadı.");
        }

        void SelectUsernameCriterion(IntPtr scope, Rect field, IntPtr grid) {
            var results = BoundsOf(grid);
            int height = field.Bottom - field.Top;
            var selectors = Children(scope).FindAll(h => {
                if (Class(h) != "TspSkinComboBox") return false;
                var box = BoundsOf(h);
                return box.Left >= field.Right && box.Right <= results.Right + height &&
                    Math.Abs(box.Top - field.Top) <= height / 2;
            });
            if (selectors.Count != 1)
                throw new InvalidOperationException("PanCafe üye arama kriteri doğrulanamadı.");
            IntPtr selector = selectors[0];
            if (IsUsernameCriterion(selector)) return;
            FocusControl(scope, selector);
            PressKey(36); // Home.
            for (int i = 0; i < 6; i++) {
                Thread.Sleep(80);
                if (IsUsernameCriterion(selector)) return;
                if (i != 5) {
                    CheckFocus(selector);
                    PressKey(40); // Down.
                }
            }
            throw new InvalidOperationException("PanCafe arama kriteri Kullanıcı Adı olarak seçilemedi.");
        }

        static bool IsUsernameCriterion(IntPtr selector) {
            var names = new[] { "Kullanıcı Adı" };
            return Matches(Caption(selector), names) || Matches(Text(selector), names) ||
                !FindScreenText(AsRectangle(BoundsOf(selector)), names[0]).IsEmpty;
        }

        static bool WaitForMemberCard(IntPtr scope, IntPtr grid, string username) {
            var boundary = BoundsOf(grid);
            for (int attempt = 0; attempt < 8; attempt++) {
                var cardEdits = Children(scope).FindAll(h => Class(h) == "TspSkinDBEdit" &&
                    (GetWindowLong(h, -16) & 0x20) == 0 && BoundsOf(h).Left >= boundary.Right &&
                    BoundsOf(h).Top <= boundary.Top + 100);
                cardEdits.Sort((left, right) => BoundsOf(left).Top.CompareTo(BoundsOf(right).Top));
                if (cardEdits.Count != 0 && Text(cardEdits[0]) == username) return true;
                Thread.Sleep(100);
            }
            return false;
        }

        bool ClickRenderedMemberCredit(IntPtr scope, IntPtr grid, string username) {
            var screen = AsRectangle(BoundsOf(scope));
            var results = BoundsOf(grid);
            // The account controls below the login fields contain the balance button.
            int top = results.Top + 120;
            int right = Math.Min(screen.Right, results.Right + 1250);
            int bottom = Math.Min(screen.Bottom, top + 900);
            if (right <= results.Right || bottom <= top) return false;
            var controls = Rectangle.FromLTRB(results.Right, top, right, bottom);
            var words = ReadScreenWords(controls);
            var label = FindMemberCreditLabel(words);
            if (label.IsEmpty) {
                var tabs = Rectangle.FromLTRB(results.Right, Math.Max(screen.Top, results.Top - 100), right, top);
                var card = FindScreenText(tabs, "Üye Kartı");
                if (!card.IsEmpty && ClickScreenText(scope, scope, card) && WaitForMemberCard(scope, grid, username)) {
                    words = ReadScreenWords(controls);
                    label = FindMemberCreditLabel(words);
                }
            }
            var knownLabels = new[] { "Üye", "Bakiye", "Bakiyesi", "Mevcut", "Düzenle", "DüzenIe", "Kredi", "Kredisi", "Bonus", "Yükle" };
            CreditScreenLabels = words.FindAll(word => Matches(word.Text, knownLabels)).ConvertAll(word => word.Text).ToArray();
            if (label.IsEmpty) return false;
            CreditNavigation = "member-balance-button";
            return ClickScreenText(scope, scope, label);
        }

        static Rectangle FindMemberCreditLabel(List<PanCafeScreenText.Match> words) {
            foreach (string caption in MemberCreditActions) {
                var rect = PanCafeScreenText.FindUnique(words, caption);
                if (!rect.IsEmpty) return rect;
                if (caption.Contains("Düzenle")) {
                    rect = PanCafeScreenText.FindUnique(words, caption.Replace("Düzenle", "DüzenIe"));
                    if (!rect.IsEmpty) return rect;
                }
            }
            // PanCafe can draw the balance action without exposing the caption, and
            // the skin may render only "Bakiye" clearly. Locate that action between
            // the current-balance heading and the cumulative-credit figures.
            var heading = PanCafeScreenText.FindUnique(words, "Mevcut Bakiye");
            if (heading.IsEmpty) return Rectangle.Empty;
            var candidates = words.FindAll(word => word.Text == "Bakiye" &&
                word.Bounds.Top > heading.Bottom + heading.Height * 3 &&
                Math.Abs(word.Bounds.Left - heading.Left) <= heading.Width * 2 &&
                words.Exists(total => total.Text.Equals("kredi", StringComparison.OrdinalIgnoreCase) &&
                    total.Bounds.Top > word.Bounds.Bottom && total.Bounds.Top - word.Bounds.Bottom < 130 &&
                    Math.Abs(total.Bounds.Left - word.Bounds.Left) <= heading.Width * 2));
            return candidates.Count == 1 ? candidates[0].Bounds : Rectangle.Empty;
        }

        static Rectangle AsRectangle(Rect box) { return Rectangle.FromLTRB(box.Left, box.Top, box.Right, box.Bottom); }

        static Rectangle FindScreenText(Rectangle area, string label) {
            return PanCafeScreenText.FindUnique(ReadScreenWords(area), label);
        }

        static List<PanCafeScreenText.Match> ReadScreenWords(Rectangle area) {
            var words = new List<PanCafeScreenText.Match>();
            if (area.Width < 5 || area.Height < 5) return words;
            using (var image = new Bitmap(area.Width, area.Height)) {
                using (var graphics = Graphics.FromImage(image))
                    graphics.CopyFromScreen(area.Location, System.Drawing.Point.Empty, area.Size);
                foreach (var word in PanCafeScreenText.Read(image)) {
                    var rect = word.Bounds;
                    if (!rect.IsEmpty) rect.Offset(area.Location);
                    words.Add(new PanCafeScreenText.Match(word.Text, rect));
                }
            }
            return words;
        }

        static bool ClickScreenText(IntPtr scope, IntPtr within, Rectangle text) {
            var point = new Point { X = text.Left + text.Width / 2, Y = text.Top + text.Height / 2 };
            var hit = WindowFromPoint(point);
            if ((hit != within && !IsChild(within, hit)) || !ScreenToClient(hit, ref point)) return false;
            Click(scope, hit, point.X, point.Y);
            return true;
        }

        bool ClickMemberToolbar() {
            Activate(main);
            var origin = new Point();
            if (!ClientToScreen(main, ref origin)) return false;
            double dpi = GetDpiForWindow(main) / 96.0;
            if (dpi < 0.75 || dpi > 3) return false;
            var client = ClientBounds(main);
            var area = new Rectangle(origin.X, origin.Y, Math.Min(client.Right, (int)(610 * dpi)),
                Math.Min(client.Bottom, (int)(120 * dpi)));
            if (area.Width < 250 || area.Height < 56) return false;
            using (var header = new Bitmap(area.Width, area.Height)) {
                using (var graphics = Graphics.FromImage(header))
                    graphics.CopyFromScreen(area.Location, System.Drawing.Point.Empty, area.Size);
                var label = PanCafeScreenText.FindMemberToolbarLabel(header, dpi);
                if (label.IsEmpty) label = PanCafeScreenText.FindMemberToolbarIcon(header, dpi);
                if (!label.IsEmpty) {
                    label.Offset(area.Location);
                    return ClickScreenText(main, main, label);
                }
            }
            return ClickNavigationIcon(2);
        }

        bool ClickNavigationIcon(int slot) {
            if (GetForegroundWindow() != main) return false;
            var origin = new Point();
            if (!ClientToScreen(main, ref origin)) return false;
            double dpi = GetDpiForWindow(main) / 96.0;
            if (dpi < 0.75 || dpi > 3) return false;
            var client = ClientBounds(main);
            int width = Math.Min(client.Right, (int)(520 * dpi));
            int height = Math.Min(client.Bottom, (int)(115 * dpi));
            if (width < 325 * dpi || height < 65 * dpi) return false;
            using (var header = new Bitmap(width, height)) {
                using (var graphics = Graphics.FromImage(header)) {
                    graphics.CopyFromScreen(origin.X, origin.Y, 0, 0, header.Size);
                }
                Point point;
                if (!LocateNavigationIcon(header, dpi, slot, out point)) return false;
                var screen = new Point { X = origin.X + point.X, Y = origin.Y + point.Y };
                var target = WindowFromPoint(screen);
                if ((target != main && !IsChild(main, target)) || !ScreenToClient(target, ref screen)) return false;
                Click(main, target, screen.X, screen.Y);
                return true;
            }
        }

        static bool LocateNavigationIcon(Bitmap header, double dpi, int slot, out Point point) {
            point = new Point();
            int best = 0;
            // The large navigation row starts with Genel, Ayarlar, Üyeler, Bilet.
            // Match a row of aligned icon blocks before using a slot from the skin toolbar.
            for (double scale = dpi * 0.85; scale <= dpi * 1.2; scale += dpi * 0.05) {
                int half = (int)(14 * scale);
                int radius = (int)(12 * scale);
                for (int y = (int)(24 * scale); y + radius < Math.Min(header.Height, 90 * dpi); y += Math.Max(1, (int)(5 * dpi))) {
                    var strengths = new int[4];
                    for (int i = 0; i < strengths.Length; i++) {
                        int x = (int)((43 + 74 * i) * scale);
                        if (x + half >= header.Width) break;
                        for (int px = x - half; px <= x + half; px += 2)
                            for (int py = y - radius; py <= y + radius; py += 2) {
                                Color c = header.GetPixel(px, py);
                                int high = Math.Max(c.R, Math.Max(c.G, c.B));
                                int low = Math.Min(c.R, Math.Min(c.G, c.B));
                                if (high >= 90 && high - low >= 42) strengths[i]++;
                            }
                    }
                    int visibleIcons = Array.FindAll(strengths, amount => amount >= 8).Length;
                    int score = visibleIcons * 500;
                    foreach (int amount in strengths) score += Math.Min(80, amount);
                    if (visibleIcons < 3 || strengths[slot] < 8 || score <= best) continue;
                    best = score;
                    point = new Point { X = (int)((43 + 74 * slot) * scale), Y = y };
                }
            }
            return best > 0;
        }

        IntPtr CreditPopup() { return GetLastActivePopup(creditOwner == IntPtr.Zero ? main : creditOwner); }

        IntPtr MemberWindow() {
            var popup = GetLastActivePopup(main);
            uint owner;
            GetWindowThreadProcessId(popup, out owner);
            return popup != main && owner == processId && IsWindowVisible(popup) && Matches(Caption(popup), MemberScreens)
                ? popup : IntPtr.Zero;
        }

        bool WaitForRow(IntPtr scope, string value, bool member, out IntPtr target, out int row) {
            for (int attempt = 0; attempt < 6; attempt++) {
                if (FindRow(scope, value, member, out target, out row)) return true;
                Thread.Sleep(130);
            }
            target = IntPtr.Zero;
            row = -1;
            return false;
        }

        bool FindRow(IntPtr scope, string value, bool member, out IntPtr target, out int row) {
            target = IntPtr.Zero;
            row = -1;
            foreach (var control in Children(scope)) {
                string type = Class(control);
                if (type != "TspSkinListView" && type != "TListView" && type != "SysListView32") continue;
                using (var items = new RemoteList(control, processId)) {
                    int column = items.UsernameColumn();
                    if (member != (column >= 0)) continue;
                    int index = items.FindExact(value, Math.Max(0, column));
                    if (index < 0) continue;
                    if (target != IntPtr.Zero) throw new InvalidOperationException("PanCafe listesinde birden fazla eşleşme bulundu.");
                    target = control;
                    row = index;
                }
            }
            return target != IntPtr.Zero;
        }

        bool ClickNamed(IntPtr scope, string[] names) {
            var controls = Children(scope).FindAll(h => IsWindowEnabled(h) && IsActionControl(Class(h)) &&
                (Matches(Caption(h), names) || Matches(Text(h), names)));
            if (controls.Count == 1) {
                var bounds = ClientBounds(controls[0]);
                MenuClick(controls[0], bounds.Right / 2, bounds.Bottom / 2);
                return true;
            }
            if (controls.Count > 1) return false;

            var root = AccessibilityClient(scope);
            if (root != null) {
                int budget = 180;
                var actions = new List<AccessibleAction>();
                FindActions(root, 0, names, actions, 0, ref budget);
                if (actions.Count > 1) return false;
                if (actions.Count == 1 && InvokeAccessible(scope, actions[0])) return true;
            }
            foreach (var tab in Children(scope)) {
                string type = Class(tab);
                if (!type.Contains("TabControl") && !type.Contains("PageControl")) continue;
                using (var tabs = new RemoteList(tab, processId)) {
                    if (tabs.SelectNamedTab(name => Matches(name, names))) return true;
                }
            }
            return false;
        }

        bool InvokeAccessible(IntPtr scope, AccessibleAction action) {
            try {
                int x, y, width, height;
                action.Owner.accLocation(out x, out y, out width, out height, action.Child);
                if (width > 0 && height > 0) {
                    var point = new Point { X = x + width / 2, Y = y + height / 2 };
                    IntPtr hit = WindowFromPoint(point);
                    uint owner;
                    GetWindowThreadProcessId(hit, out owner);
                    if (owner == processId && (hit == scope || IsChild(scope, hit)) && ScreenToClient(hit, ref point)) {
                        MenuClick(hit, point.X, point.Y);
                        return true;
                    }
                }
                if (String.IsNullOrWhiteSpace(action.Owner.get_accDefaultAction(action.Child))) return false;
                action.Owner.accDoDefaultAction(action.Child);
                return true;
            } catch (COMException) { return false; }
        }

        static bool IsActionControl(string type) {
            return type.Contains("Button") || type.Contains("Tab") || type.Contains("MenuItem");
        }

        static bool Matches(string caption, string[] names) {
            if (String.IsNullOrWhiteSpace(caption)) return false;
            var label = caption.Split('\t')[0].Replace("&", "").Trim().TrimEnd('.');
            return Array.Exists(names, name => String.Equals(name, label, StringComparison.OrdinalIgnoreCase));
        }

        sealed class AccessibleAction {
            public IAccessible Owner;
            public object Child;
        }

        static void FindActions(IAccessible node, object child, string[] names,
            List<AccessibleAction> actions, int depth, ref int budget) {
            if (actions.Count > 1 || budget-- <= 0 || depth > 7) return;
            try {
                int state = Convert.ToInt32(node.get_accState(child));
                if ((state & 0x8001) != 0) return; // Invisible or disabled.
                object roleValue = node.get_accRole(child);
                int role = roleValue is int ? (int)roleValue : 0;
                // Menus, menu commands, tabs, tab containers and buttons.
                if ((role == 2 || role == 11 || role == 12 || role == 37 || role == 43 || role == 60) &&
                    Matches(node.get_accName(child), names))
                    actions.Add(new AccessibleAction { Owner = node, Child = child });
                if (!Equals(child, 0) || role == 24 || role == 33) return; // Skip tables and lists.
                int count = Math.Min(node.accChildCount, Math.Max(0, budget));
                if (count == 0) return;
                var children = new object[count];
                int read;
                if (AccessibleChildren(node, 0, count, children, out read) < 0) return;
                for (int i = 0; i < read; i++) {
                    var accessible = children[i] as IAccessible;
                    if (accessible != null) FindActions(accessible, 0, names, actions, depth + 1, ref budget);
                    else if (children[i] is int) FindActions(node, children[i], names, actions, depth + 1, ref budget);
                }
            } catch (COMException) { }
        }

        static IAccessible AccessibilityClient(IntPtr control) {
            Guid iid = typeof(IAccessible).GUID;
            IAccessible accessible;
            return AccessibleObjectFromWindow(control, 0xFFFFFFFC, ref iid, out accessible) == 0 ? accessible : null;
        }

        static bool IsChecked(IntPtr control) {
            if (Message(control, 0xF0, 0, IntPtr.Zero) == 1) return true;
            try {
                var accessible = AccessibilityClient(control);
                return accessible != null && (Convert.ToInt32(accessible.get_accState(0)) & 0x10) != 0;
            } catch (COMException) { return false; }
        }
    }

    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h, uint id, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IAccessible accessible);
    [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible parent, int start, int count,
        [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] object[] children, out int read);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref Point point);
    [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent, IntPtr h);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
}
