using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Globalization;
using System.Text;
using System.Threading;
using Windows.Foundation;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

// Read only the requested PanCafe control region. The captured pixels stay in memory.
internal static class PanCafeScreenText {
    internal sealed class Match {
        public readonly string Text;
        public readonly Rectangle Bounds;
        public Match(string text, Rectangle bounds) { Text = text; Bounds = bounds; }
    }

    internal static List<Match> Read(Bitmap image) {
        var matches = new List<Match>();
        var engine = OcrEngine.TryCreateFromLanguage(new Language("tr"));
        if (engine == null) throw new InvalidOperationException("Windows Türkçe metin tanıma bileşeni hazır değil.");
        int limit = (int)OcrEngine.MaxImageDimension;
        if (image.Width > limit || image.Height > limit)
            throw new InvalidOperationException("PanCafe metin alanı çok büyük.");
        int scale = Math.Max(image.Width, image.Height) * 2 <= limit ? 2 : 1;
        using (var enlarged = new Bitmap(image, image.Width * scale, image.Height * scale))
        using (var png = new MemoryStream())
        using (var stream = new InMemoryRandomAccessStream())
        using (var writer = new DataWriter(stream.GetOutputStreamAt(0))) {
            using (var graphics = Graphics.FromImage(enlarged)) {
                graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
                graphics.PixelOffsetMode = PixelOffsetMode.Half;
                graphics.DrawImage(image, new Rectangle(0, 0, enlarged.Width, enlarged.Height));
            }
            enlarged.Save(png, ImageFormat.Png);
            writer.WriteBytes(png.ToArray());
            Await<uint>(writer.StoreAsync());
            var decoder = Await(BitmapDecoder.CreateAsync(stream));
            using (var bitmap = Await(decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied))) {
                var result = Await(engine.RecognizeAsync(bitmap));
                foreach (var line in result.Lines) {
                    foreach (var word in line.Words) {
                        var box = word.BoundingRect;
                        matches.Add(new Match(word.Text, Rectangle.FromLTRB(
                            (int)Math.Floor(box.X / scale), (int)Math.Floor(box.Y / scale),
                            (int)Math.Ceiling((box.X + box.Width) / scale), (int)Math.Ceiling((box.Y + box.Height) / scale))));
                    }
                    matches.Add(new Match("", Rectangle.Empty)); // Separate OCR lines.
                }
            }
        }
        return matches;
    }

    internal static Rectangle FindUnique(List<Match> words, string label, bool normalizeLabel = false) {
        string[] target = label.Split(' ');
        if (normalizeLabel) target = Array.ConvertAll(target, NormalizeLabel);
        var result = Rectangle.Empty;
        for (int i = 0; i <= words.Count - target.Length; i++) {
            var match = Rectangle.Empty;
            int j;
            for (j = 0; j < target.Length; j++) {
                string word = normalizeLabel ? NormalizeLabel(words[i+j].Text) : words[i+j].Text;
                if (!String.Equals(word, target[j], StringComparison.OrdinalIgnoreCase)) break;
                match = match.IsEmpty ? words[i+j].Bounds : Rectangle.Union(match, words[i+j].Bounds);
            }
            if (j != target.Length) continue;
            if (!result.IsEmpty) return Rectangle.Empty;
            result = match;
        }
        return result;
    }

    static string NormalizeLabel(string text) {
        var result = new StringBuilder(text.Length);
        foreach (char character in text.Trim().TrimEnd('.', '…', ':').Normalize(NormalizationForm.FormD)) {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
                result.Append(character == 'ı' ? 'i' : Char.ToLowerInvariant(character));
        }
        return result.ToString();
    }

    internal static Rectangle FindTicketSaleLabel(List<Match> words) {
        var label = FindUnique(words, "Bilet Satışı", true);
        // The PanCafe skin can make OCR merge the last dotless i into the ellipsis.
        return label.IsEmpty ? FindUnique(words, "Bilet Satış", true) : label;
    }

    internal static Rectangle FindTicketSaleButton(Bitmap page, double dpi) {
        // On PanCafe's ticket page the small orange ticket is immediately left of
        // the sale label. A close crop keeps other captions from masking that label.
        var icons = new List<Rectangle>();
        for (int y = 0; y < page.Height; y += 2) {
            int start = -1;
            for (int x = 0; x <= page.Width + 1; x += 2) {
                if (x < page.Width) {
                    Color color = page.GetPixel(x, y);
                    if (color.R >= 145 && color.G >= 80 && color.R > color.G && color.G >= color.B + 29) {
                        if (start < 0) start = x;
                        continue;
                    }
                }
                if (start < 0) continue;
                int runWidth = x - start;
                if (runWidth >= 8 * dpi && runWidth <= 38 * dpi) {
                    int index = icons.FindLastIndex(icon => icon.Bottom == y &&
                        Math.Min(icon.Right, x) - Math.Max(icon.Left, start) >= 4 * dpi);
                    var run = new Rectangle(start, y, runWidth, 2);
                    if (index >= 0) icons[index] = Rectangle.Union(icons[index], run);
                    else icons.Add(run);
                }
                start = -1;
            }
        }
        int attempts = 0;
        foreach (var icon in icons) {
            if (icon.Height < 6 * dpi || icon.Height > 23 * dpi ||
                icon.Width < 12 * dpi || icon.Width > 36 * dpi || icon.Width < icon.Height)
                continue;
            if (++attempts > 12) break;
            int left = icon.Right - (int)(3 * dpi);
            var textArea = Rectangle.Intersect(new Rectangle(0, 0, page.Width, page.Height),
                new Rectangle(left, icon.Top - (int)(7 * dpi), (int)(126 * dpi), icon.Height + (int)(14 * dpi)));
            if (textArea.Width < 60 * dpi || textArea.Height < 14 * dpi) continue;
            using (var crop = page.Clone(textArea, page.PixelFormat)) {
                var label = FindTicketSaleLabel(Read(crop));
                if (!label.IsEmpty) {
                    label.Offset(textArea.Location);
                    return label;
                }
            }
        }
        return FindTicketSaleLabel(Read(page));
    }

    internal static Rectangle FindMemberToolbarLabel(Bitmap header, double dpi) {
        var words = Read(header);
        var settings = FindUnique(words, "Ayarlar");
        var tickets = FindUnique(words, "Bilet");
        if (settings.IsEmpty || tickets.IsEmpty) return Rectangle.Empty;
        var members = words.FindAll(word => {
            if (!word.Text.Equals("Üyeler", StringComparison.OrdinalIgnoreCase) &&
                !word.Text.Equals("Uyeler", StringComparison.OrdinalIgnoreCase)) return false;
            var box = word.Bounds;
            int left = box.Left - settings.Left, right = tickets.Left - box.Left;
            return Math.Abs(box.Top - settings.Top) <= 8 * dpi && Math.Abs(box.Top - tickets.Top) <= 8 * dpi &&
                left >= 38 * dpi && left <= 125 * dpi && right >= 38 * dpi && right <= 125 * dpi;
        });
        return members.Count == 1 ? members[0].Bounds : Rectangle.Empty;
    }

    internal static Rectangle FindMemberToolbarIcon(Bitmap header, double dpi) {
        return FindAdjacentMemberAndTicketIcons(header, dpi, false);
    }

    internal static Rectangle FindTicketToolbarIcon(Bitmap header, double dpi) {
        return FindAdjacentMemberAndTicketIcons(header, dpi, true);
    }

    static Rectangle FindAdjacentMemberAndTicketIcons(Bitmap header, double dpi, bool findTicket) {
        // PanCafe's dark theme draws the two blue people immediately to the left of the orange ticket.
        var blue = ToolbarColorRuns(header, dpi, c => c.B >= 105 && c.B >= c.R + 45 && c.B >= c.G + 25);
        var orange = ToolbarColorRuns(header, dpi, c => c.R >= 135 && c.R >= c.G + 35 && c.G >= c.B + 27);
        var matches = new List<Rectangle>();
        foreach (var member in blue) {
            int x = member.Left + member.Width / 2;
            int y = member.Top + member.Height / 2;
            if (x < 128 * dpi || x > 258 * dpi) continue;
            foreach (var ticket in orange) {
                int gap = ticket.Left + ticket.Width / 2 - x;
                if (gap < 45 * dpi || gap > 103 * dpi ||
                    Math.Abs(ticket.Top + ticket.Height / 2 - y) > 12 * dpi) continue;
                matches.Add(findTicket ? ticket : member);
            }
        }
        return matches.Count == 1 ? matches[0] : Rectangle.Empty;
    }

    static List<Rectangle> ToolbarColorRuns(Bitmap header, double dpi, Func<Color,bool> matches) {
        var runs = new List<Rectangle>();
        int maxGap = Math.Max(2, (int)Math.Ceiling(4 * dpi));
        var icon = Rectangle.Empty;
        int lastY = Math.Min(header.Height, (int)(96 * dpi));
        for (int x = 0; x < header.Width + maxGap; x++) {
            int top = lastY, bottom = 0, count = 0;
            if (x < header.Width) {
                for (int y = (int)(5 * dpi); y < lastY; y++) {
                    if (!matches(header.GetPixel(x, y))) continue;
                    top = Math.Min(top, y);
                    bottom = y + 1;
                    count++;
                }
            }
            if (count >= Math.Max(2, (int)(3 * dpi))) {
                var column = Rectangle.FromLTRB(x, top, x + 1, bottom);
                icon = icon.IsEmpty ? column : Rectangle.Union(icon, column);
            } else if (!icon.IsEmpty && x - icon.Right + 1 >= maxGap) {
                if (icon.Width >= 15 * dpi && icon.Width <= 60 * dpi &&
                    icon.Height >= 15 * dpi && icon.Height <= 55 * dpi)
                    runs.Add(icon);
                icon = Rectangle.Empty;
            }
        }
        return runs;
    }

    internal static bool IsAddSelected(Bitmap picture) {
        var words = Read(picture);
        return IsAddSelected(picture, FindUnique(words, "Ekle"), FindUnique(words, "Çıkar"));
    }

    internal static bool IsAddSelectedInControls(Bitmap picture, Rectangle add, Rectangle subtract) {
        if (add.Height != subtract.Height || add.Left != subtract.Left ||
            add.Height < 16 || add.Height > 60 || subtract.Top - add.Top < add.Height * 3 / 4)
            return false;
        var selected = new System.Drawing.Point(add.Left + (int)Math.Round(add.Height * 0.44), add.Top + add.Height / 2);
        var other = new System.Drawing.Point(selected.X, subtract.Top + subtract.Height / 2);
        int radius = (int)Math.Round(add.Height * 0.24);
        if (selected.X < radius || selected.X + radius >= picture.Width ||
            selected.Y < radius || other.Y + radius >= picture.Height) return false;
        double addCenter = CenterLight(picture, selected.X, selected.Y);
        double subtractCenter = CenterLight(picture, other.X, other.Y);
        return addCenter - subtractCenter >= 45 &&
            addCenter >= RingLight(picture, selected.X, selected.Y, radius) + 20 &&
            subtractCenter <= RingLight(picture, other.X, other.Y, radius) - 20;
    }

    internal static bool IsAddSelected(Bitmap picture, Rectangle add, Rectangle subtract) {
        if (add.IsEmpty || subtract.IsEmpty || Math.Abs(add.Left - subtract.Left) > 8 || add.Bottom >= subtract.Top)
            return false;
        System.Drawing.Point addDot, subtractDot;
        double addCenter, subtractCenter, addRing, subtractRing;
        return TryReadRadio(picture, add, out addDot, out addCenter, out addRing) &&
            TryReadRadio(picture, subtract, out subtractDot, out subtractCenter, out subtractRing) &&
            Math.Abs(addDot.X - subtractDot.X) <= 4 &&
            addCenter >= addRing + 20 && subtractCenter <= subtractRing - 20 &&
            addCenter - subtractCenter >= 45;
    }

    static bool TryReadRadio(Bitmap image, Rectangle label, out System.Drawing.Point dot, out double center, out double ringLight) {
        dot = System.Drawing.Point.Empty;
        center = 0;
        ringLight = 0;
        int middle = label.Top + label.Height / 2;
        int vertical = Math.Max(2, label.Height / 3);
        for (int radius = Math.Max(4, label.Height / 3); radius <= Math.Max(5, label.Height * 3 / 4); radius++)
            for (int x = label.Left - label.Height * 2; x <= label.Left - radius - 2; x++)
                for (int y = middle - vertical; y <= middle + vertical; y++) {
                    if (x - radius < 0 || x + radius >= image.Width || y - radius < 0 || y + radius >= image.Height) continue;
                    double ring = RingLight(image, x, y, radius);
                    if (ring < 140 || ring <= ringLight) continue;
                    ringLight = ring;
                    dot = new System.Drawing.Point(x, y);
                    center = CenterLight(image, x, y);
                }
        return !dot.IsEmpty;
    }

    static double CenterLight(Bitmap image, int x, int y) {
        return (Light(image, x, y) + Light(image, x-1, y) + Light(image, x+1, y) +
            Light(image, x, y-1) + Light(image, x, y+1)) / 5.0;
    }

    static double RingLight(Bitmap image, int x, int y, int radius) {
        int diagonal = (int)Math.Round(radius * 0.707);
        return (Light(image, x-radius, y) + Light(image, x+radius, y) +
            Light(image, x, y-radius) + Light(image, x, y+radius) +
            Light(image, x-diagonal, y-diagonal) + Light(image, x+diagonal, y-diagonal) +
            Light(image, x-diagonal, y+diagonal) + Light(image, x+diagonal, y+diagonal)) / 8.0;
    }

    static int Light(Bitmap image, int x, int y) {
        Color color = image.GetPixel(x, y);
        return (color.R + color.G + color.B) / 3;
    }

    static T Await<T>(IAsyncOperation<T> operation) {
        for (int i = 0; i < 100 && operation.Status == AsyncStatus.Started; i++) Thread.Sleep(20);
        if (operation.Status == AsyncStatus.Started) {
            operation.Cancel();
            throw new InvalidOperationException("PanCafe metni zamanında okunamadı.");
        }
        return operation.GetResults();
    }
}
