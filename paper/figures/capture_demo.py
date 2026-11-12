"""Captures Figure 2 (the demo interface) from the running app.

    cd frontend && npm run build && npm run start        # or: npm run dev
    pip install playwright && playwright install chromium
    python paper/figures/capture_demo.py                 # writes demo-*.png next to this file

What it does: opens the demo shell, dismisses the newsletter pop-up, picks a shopper, presses
Run, and takes one screenshot while the last stage of the layout swap is still tagged in the
store. It then cuts three regions out of that one frame:

    demo-store.png      the store in its browser frame, mid-rearrangement
    demo-persona.png    the shopper picker and the first shopping-mix sliders
    demo-terminal.png   the live terminal

Nothing is drawn onto the images. The numbered callouts in the paper are added in main.tex.

Options:
    --url       where the app runs (default http://localhost:3000)
    --shopper   tile to click before Run: "Price Hunter", "Trend Seeker", ... (default Price Hunter)
    --say       instead of Run, type this sentence into the concierge and capture that rearrangement
                (needs NEBIUS_API_KEY or GEMINI_API_KEY in frontend/.env.local for a live reply)
    --chrome    path to a Chrome binary, if Playwright's own Chromium is not installed
"""
from __future__ import annotations

import argparse
import asyncio
import re
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
VIEWPORT = {"width": 1440, "height": 900}
SCALE = 2
PERSONA_WIDTH = 504       # CSS px: the left panel at this viewport
TERMINAL_WIDTH = 540      # CSS px: wide enough for the longest layout line


async def last_step_started(page) -> bool:
    """True once the terminal shows the final 'step k/k' line of the swap."""
    text = await page.locator(".font-mono").first.inner_text()
    steps = re.findall(r"step (\d+)/(\d+)", text)
    return bool(steps) and steps[-1][0] == steps[-1][1]


async def capture(args) -> None:
    async with async_playwright() as p:
        launch = {"executable_path": args.chrome, "args": ["--no-sandbox"]} if args.chrome else {}
        browser = await p.chromium.launch(**launch)
        context = await browser.new_context(viewport=VIEWPORT, device_scale_factor=SCALE)
        page = await context.new_page()
        await page.goto(args.url, wait_until="networkidle")
        await page.wait_for_timeout(3500)
        store = next(f for f in page.frames if f.url.rstrip("/").endswith("/store"))
        try:
            await store.get_by_role("button", name="No thanks").click(timeout=4000)
        except Exception:
            pass  # the layout in force shows no pop-up
        await page.wait_for_timeout(500)

        if args.say:
            await store.get_by_role("button", name="Concierge").click()
            box = store.get_by_placeholder("Ask about the store…")
            await box.fill(args.say)
            await box.press("Enter")
        else:
            await page.get_by_role("button", name=re.compile(args.shopper.replace(" ", r"\s+"), re.I)).first.click()
            await page.get_by_role("button", name="Run", exact=True).click()

        # wait for the last stage of the swap
        for _ in range(400):
            if await last_step_started(page):
                break
            await page.wait_for_timeout(100)
        # the stage first scrolls the store back to the top, then boxes the change (700 ms),
        # plays it (1100 ms) and holds the tag (700 ms): shoot early in the hold
        still = 0
        for _ in range(60):
            still = still + 1 if await store.evaluate("window.scrollY") == 0 else 0
            if still >= 3:
                break
            await page.wait_for_timeout(100)
        await page.wait_for_timeout(1850)
        # keep the shopper picker in view rather than the bottom of the panel
        await page.evaluate(
            "document.querySelectorAll('[data-slot=scroll-area-viewport]').forEach((el) => { el.scrollTop = 0 })"
        )
        await page.wait_for_timeout(120)
        shot = HERE / "demo-full.png"
        await page.screenshot(path=str(shot))

        frame_box = await page.locator('iframe[title="SOCAL ATELIER"]').locator("xpath=..").bounding_box()
        tile = await page.get_by_role("button", name=re.compile(r"price\s+hunter", re.I)).first.bounding_box()
        divided = await page.get_by_text("Divided", exact=True).first.bounding_box()
        log = await page.locator(".font-mono").first.locator("xpath=./div[1]").bounding_box()
        await browser.close()

    full = Image.open(shot).convert("RGB")

    def cut(x0: float, y0: float, x1: float, y1: float, name: str) -> None:
        region = full.crop(tuple(int(round(v * SCALE)) for v in (x0, y0, x1, y1)))
        region.save(HERE / name, optimize=True)
        print(f"{name}: {region.width} x {region.height} px")

    fb = frame_box
    cut(fb["x"], fb["y"], fb["x"] + fb["width"], fb["y"] + fb["height"], "demo-store.png")
    cut(0, tile["y"] - 24, PERSONA_WIDTH, divided["y"] - 6, "demo-persona.png")
    cut(log["x"], log["y"], log["x"] + TERMINAL_WIDTH, log["y"] + log["height"], "demo-terminal.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://localhost:3000")
    parser.add_argument("--shopper", default="Price Hunter")
    parser.add_argument("--say", default="")
    parser.add_argument("--chrome", default="")
    asyncio.run(capture(parser.parse_args()))
