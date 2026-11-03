"""Requested (the chair, 3 Nov 2026): "Alt der kan automatiseres skal automatiseres" - "Ugens events" as a reel, made every week without anyone's hands,
as Gitta made one by hand each week. Run by .github/workflows/ugens-reel.yml (Thursday-Sunday, every hour) after Saga has planned the week.

  python3 -I weekly-reel.py <week.json> <events.json> <out-dir> <now-ms>

week.json and events.json are `wrangler d1 execute --json` answers: the coming week's "Ugens events" post, and that week's event posts. When there is
something to make, the script writes <out-dir>/reel.mp4 (1080 x 1920, H.264, ~3 s a slide, silent audio), <out-dir>/insert.sql (the reel as a draft for
the chair, kind 'week', source_key 'reel:<week>', Instagram only, Monday an hour after "Ugens events") and <out-dir>/name (the file's name in R2);
otherwise <out-dir>/skip with the reason. Only the house's own logo file is drawn, never a logo of our own making."""

import json, os, secrets, subprocess, sys, urllib.request, io
from datetime import datetime, timezone, timedelta
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

W, H = 1080, 1920
CREAM, SAND, INK, MUTED, TERRA, CAMEL, DUSK = "#f6f1e7", "#efe4d6", "#2a2622", "#5b534b", "#94503f", "#c9976f", "#2a1e18"
SITE = "https://www.hjerterum.info"
HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, "..", "..", "apps", "web", "public", "brand", "hjerterum-stempel.png")
FONTS = os.environ.get("REEL_FONTS", "/tmp/reel-fonts")
DAYS = ["MAN.", "TIRS.", "ONS.", "TORS.", "FRE.", "LØR.", "SØN."]
SECONDS = 3.0


def rows(path):
    data = json.load(open(path))
    first = data[0] if isinstance(data, list) else data
    return first.get("results", []) if isinstance(first, dict) else []


def font(kind, size):
    for name in ({"serif": ["PlayfairDisplay.ttf", "DejaVuSerif.ttf"], "serif-italic": ["PlayfairDisplay-Italic.ttf", "DejaVuSerif-Italic.ttf"],
                  "sans": ["Inter.ttf", "DejaVuSans.ttf"], "sans-bold": ["Inter.ttf", "DejaVuSans-Bold.ttf"]}[kind]):
        for folder in (FONTS, "/usr/share/fonts/truetype/dejavu"):
            p = os.path.join(folder, name)
            if os.path.exists(p):
                f = ImageFont.truetype(p, size)
                if kind == "sans-bold" and name.startswith("Inter"):
                    try: f.set_variation_by_name("SemiBold")
                    except Exception: pass
                return f
    return ImageFont.load_default(size)


def copenhagen(ms):
    utc = datetime.fromtimestamp(ms / 1000, timezone.utc)
    # Danish summer time: last Sunday of March 01 UTC to last Sunday of October 01 UTC.
    def last_sunday(year, month):
        d = datetime(year, month + 1, 1, tzinfo=timezone.utc) - timedelta(days=1)
        return d - timedelta(days=(d.weekday() + 1) % 7)
    start = last_sunday(utc.year, 3).replace(hour=1); end = last_sunday(utc.year, 10).replace(hour=1)
    return utc + timedelta(hours=2 if start <= utc < end else 1)


def wrap(draw, text, f, width, lines=3):
    words, out, line = text.split(), [], ""
    for w in words:
        test = (line + " " + w).strip()
        if draw.textlength(test, font=f) <= width or not line: line = test
        else: out.append(line); line = w
    if line: out.append(line)
    if len(out) > lines:
        out = out[:lines]; out[-1] = out[-1].rstrip(".,") + " …"
    return out


def fetch(url):
    try:
        req = urllib.request.Request(url, headers={"user-agent": "Hjerterum-reel"})
        with urllib.request.urlopen(req, timeout=30) as r:
            if not r.headers.get("content-type", "").startswith("image/"): return None
            return Image.open(io.BytesIO(r.read(12 * 1024 * 1024))).convert("RGB")
    except Exception:
        return None


def logo_image(size, color):
    """The house's own stamp, in one colour - dark on the light slides, light on the dark ones (its shape is never changed)."""
    try:
        img = Image.open(LOGO).convert("RGBA"); img.thumbnail((size, size))
        alpha = img.getchannel("A")
        if alpha.getextrema()[0] == 255: alpha = ImageOps.invert(img.convert("L"))  # no transparency: the dark lines are the stamp
        out = Image.new("RGBA", img.size, color); out.putalpha(alpha); return out
    except Exception:
        return None


def title_from(title):
    t = title.split(" | ")[0]
    for word in ("Hjerterum ",):
        if t.startswith(word): t = t[len(word):]
    return t.strip() or title


def card(lines_top, big, small, background=CREAM, ink=INK):
    img = Image.new("RGB", (W, H), background); d = ImageDraw.Draw(img)
    logo = logo_image(260, ink)
    if logo: img.logo = (logo, W // 2, 420 + logo.height // 2)  # turned into place in render()
    y = 820
    for t in lines_top:
        f = font("sans-bold", 40); d.text(((W - d.textlength(t, font=f)) / 2, y), t, font=f, fill=TERRA); y += 70
    f = font("serif", 120)
    for line in wrap(d, big, f, W - 160, 2):
        d.text(((W - d.textlength(line, font=f)) / 2, y), line, font=f, fill=ink); y += 140
    f = font("sans", 44)
    for line in wrap(d, small, f, W - 200, 3):
        d.text(((W - d.textlength(line, font=f)) / 2, y + 30), line, font=f, fill=MUTED if background == CREAM else ink); y += 62
    return img


def event_slide(event, photo):
    if photo is not None:
        img = ImageOps.fit(photo, (W, H), Image.LANCZOS)
        shade = Image.new("L", (1, H)); [shade.putpixel((0, y), int(max(0, (y - H * 0.45) / (H * 0.55)) * 215)) for y in range(H)]
        img.paste(Image.new("RGB", (W, H), DUSK), (0, 0), shade.resize((W, H)))
        ink, accent = CREAM, CAMEL
    else:
        img = Image.new("RGB", (W, H), SAND); ink, accent = INK, TERRA
    d = ImageDraw.Draw(img)
    when = copenhagen(event["startsMs"])
    label = f"{DAYS[when.weekday()]} {when.day}/{when.month} · {when.strftime('%H.%M')}"
    y = H - 620
    f = font("sans-bold", 46); d.text((90, y), label, font=f, fill=accent); y += 90
    f = font("serif", 96)
    for line in wrap(d, title_from(event["title"]), f, W - 180, 3):
        d.text((90, y), line, font=f, fill=ink); y += 112
    if event.get("host"):
        f = font("serif-italic", 56); d.text((90, y + 14), f"med {event['host']}", font=f, fill=ink)
    logo = logo_image(130, CREAM if photo is not None else INK)
    if logo: img.logo = (logo, W - 90 - logo.width // 2, 90 + logo.height // 2)
    return img


LOGO_TURN = 1.6  # seconds the stamp takes to turn from 270 degrees into place


def render(slides, out):
    folder = os.path.dirname(out)
    frames = int(SECONDS * 30)
    inputs, filters, n = [], [], 0
    for i, slide in enumerate(slides):
        png = os.path.join(folder, f"s{i:02d}.png"); slide.save(png)
        inputs += ["-loop", "1", "-t", str(SECONDS), "-i", png]; bg = n; n += 1
        # A slow push in, and a short fade between the slides.
        filters.append(f"[{bg}:v]scale={int(W*1.08)}:{int(H*1.08)},zoompan=z='min(1+0.0009*on,1.06)':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps=30,"
                       f"trim=end_frame={frames},setpts=PTS-STARTPTS[b{i}]")
        last = f"b{i}"
        logo = getattr(slide, "logo", None)
        if logo:
            # The stamp turns from 270 degrees back to 0 at the start of each slide, slowing down as it lands.
            stamp, cx, cy = logo
            path = os.path.join(folder, f"l{i:02d}.png"); stamp.save(path)
            inputs += ["-framerate", "30", "-loop", "1", "-t", str(SECONDS), "-i", path]; lg = n; n += 1
            filters.append(f"[{lg}:v]format=rgba,rotate=a='3*PI/2*pow(1-min(t/{LOGO_TURN},1),3)':c=none:ow='hypot(iw,ih)':oh=ow[l{i}]")
            filters.append(f"[{last}][l{i}]overlay=x={cx}-overlay_w/2:y={cy}-overlay_h/2:eof_action=pass:format=auto[o{i}]")
            last = f"o{i}"
        filters.append(f"[{last}]fade=t=in:st=0:d=0.35,fade=t=out:st={SECONDS-0.35}:d=0.35,format=yuv420p,setsar=1[v{i}]")
    filters.append("".join(f"[v{i}]" for i in range(len(slides))) + f"concat=n={len(slides)}:v=1:a=0[v]")
    total = SECONDS * len(slides)
    cmd = ["ffmpeg", "-y", "-v", "error", *inputs, "-f", "lavfi", "-t", str(total), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
           "-filter_complex", ";".join(filters), "-map", "[v]", "-map", f"{n}:a", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
           "-r", "30", "-b:v", "6M", "-maxrate", "8M", "-bufsize", "12M", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True)


def sql(value):
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def main():
    week_path, events_path, out_dir, now_ms = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
    os.makedirs(out_dir, exist_ok=True)
    def skip(reason):
        open(os.path.join(out_dir, "skip"), "w").write(reason + "\n"); print("skip:", reason); sys.exit(0)
    week = rows(week_path)
    if not week: skip("ingen kommende uge er planlagt")
    w = week[0]
    if w.get("has_reel"): skip(f"{w['week']} har allerede sin reel")
    if not w.get("ig"): skip("Instagram er ikke forbundet")
    events = []
    for r in rows(events_path):
        try: src = json.loads(r.get("source") or "{}"); images = json.loads(r.get("images") or "[]")
        except Exception: continue
        if src.get("startsMs"): events.append({"title": src.get("title", ""), "host": src.get("host"), "startsMs": src["startsMs"], "image": images[0] if images else None})
    events.sort(key=lambda e: e["startsMs"])
    if not events: skip("ugen har ingen events med opslag")
    week_no = int(str(w["week"])[6:])
    slides = [card(["UGENS EVENTS"], f"Uge {week_no}", "i Hjerterum, Guldsmedgade 26B, Aarhus")]
    for e in events[:10]:
        slides.append(event_slide(e, fetch(e["image"]) if e["image"] else None))
    slides.append(card([], "Se alle events", "og tilmeld dig via linket i bio", background=TERRA, ink=CREAM))
    name = f"{w['week'].lower()}-{secrets.token_hex(6)}"
    render(slides, os.path.join(out_dir, "reel.mp4"))
    try: source = json.loads(w.get("source") or "{}")
    except Exception: source = {}
    caption = (source.get("instagramText") or w.get("text") or "").strip()
    at = int(w["publish_at_ms"]) + 3600_000
    reel_source = {"format": "reel", "video": f"{SITE}/api/social-reels/{name}.mp4", "events": source.get("events", []), "collaborators": source.get("collaborators", [])}
    open(os.path.join(out_dir, "insert.sql"), "w").write(
        "INSERT OR IGNORE INTO social_posts (kind, source_key, week, channels, text, link, images, source, publish_at_ms, status, created_at_ms, updated_at_ms) VALUES "
        f"('week', {sql('reel:' + w['week'])}, {sql(w['week'])}, '[\"instagram\"]', {sql(caption)}, NULL, '[]', {sql(json.dumps(reel_source, ensure_ascii=False))}, {at}, 'draft', {now_ms}, {now_ms});\n")
    open(os.path.join(out_dir, "name"), "w").write(name)
    print("made", name, len(slides), "slides")


if __name__ == "__main__":
    main()
