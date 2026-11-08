# Şeffaf marka logoları

Araç: yerleşik image_gen; background-extraction düzenlemesi, transparent_background=true. CLI/API fallback kullanılmadı.

Çıktılar:
- `ui/assets/brand-wordmark.png`: RGBA, 2172×724. Kiosk başlıkları; mobil onboarding için `apps/mobile/assets/brand-wordmark.png` kopyası.
- `ui/assets/brand-emblem.png`: RGBA, 1263×1246. Kiosk karşılama alanı ve pencere simgesi; mobil giriş ve ana sayfa için `apps/mobile/assets/brand-emblem.png` kopyası.

Her iki dosyanın köşe alfa değeri 0. Siyah/beyaz ekran görüntüsü arka planları kaldırıldı; logonun kendi siyah çizgileri ve beyaz vurguları korundu. Koyu arka planda render edilerek incelendi. Üretilmiş raster temizliği olduğu için birebir vektör kaynak yerine geçmez.

## Prompt seti

Yatay logo: “Use case: background-extraction. Edit target: attached screenshot of original S TECH E-SPOR horizontal wordmark. Extract ONLY the existing horizontal orange/yellow S TECH and blue E-SPOR wordmark. Remove entire white rectangle background, all large black screenshot margins and screenshot UI. Output a tightly cropped horizontal transparent PNG with true alpha, no large empty padding, logo occupying 95% of canvas. Preserve the exact original lettering, spelling, angled arrangement, orange-yellow gradients, blue metallic lettering and black contour strokes. Retain the thin white/silver contour immediately attached to the lettering for dark-background readability, but eliminate detached white background including gaps between letters. This is a faithful cutout, not a redesign. Do not add other text, shadows, panels, checkerboard patterns or decorations. Save the resulting PNG to disk and return its local path.”

Amblem: “Use case: background-extraction. Edit target is the attached S TECH E-SPOR 1999 lion shield logo screenshot. Extract ONLY the existing lion/blue shield/orange S TECH/blue E-SPOR/1999 emblem. Remove all external white background, black screenshot bars, phone indicator and tiny cyan interface strip at bottom. Output tightly cropped transparent PNG, true alpha, balanced small padding. Preserve the exact lion silhouette, face, mane, gold/black/white internal detail, blue shield, orange-yellow gradient letters, blue E-SPOR lettering and exact 1999 digits. Preserve internal black areas and white highlights as part of the logo; only outside background becomes transparent. Retain existing fine light edge outlines for readability on dark backgrounds, no rectangular backdrop. No redesign, no added text, no new shadows, no checkerboard, no surrounding panel. Save PNG locally and return its path.”
