# 无头浏览器冒烟测试：真实加载页面、遍历路由、捕获控制台错误与 WebGL 状态
# 运行：python tests/browser_test.py
import math
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:47823/'
SHOTS = pathlib.Path(__file__).parent / 'shots'
SHOTS.mkdir(exist_ok=True)

errors: list[str] = []
warnings: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else
            warnings.append(msg.text) if msg.type == 'warning' else None)
    page.on('pageerror', lambda err: errors.append(f'pageerror: {err}'))

    page.goto(BASE, wait_until='networkidle')
    page.wait_for_timeout(800)

    card_count = page.locator('.project-card').count()
    print(f'作品卡片数量: {card_count}')
    assert card_count >= 4, '预置作品应不少于 4 件'

    page.locator('.project-card .btn.primary').first.click()
    page.wait_for_selector('.canvas-host canvas')
    page.wait_for_timeout(1200)
    size = page.locator('.canvas-host canvas').evaluate('c => ({w: c.width, h: c.height})')
    print('画布尺寸:', size)
    assert size['w'] > 0 and size['h'] > 0, 'WebGL 画布应已分配尺寸'

    for route in ('#/body', '#/layers', '#/grind', '#/compare', '#/sheet'):
        page.evaluate(f'location.hash = "{route}"')
        page.wait_for_timeout(700)
        heading = page.locator('.page-header h2').inner_text()
        print(f'路由 {route} -> 页面「{heading}」')

    # 打磨交互：真实鼠标轨迹拖一笔
    page.evaluate('location.hash = "#/grind"')
    page.wait_for_timeout(800)
    box = page.locator('.canvas-host canvas').bounding_box()
    assert box is not None
    page.mouse.move(box['x'] + box['width'] * 0.35, box['y'] + box['height'] * 0.4)
    page.mouse.down()
    for q in range(1, 12):
        page.mouse.move(
            box['x'] + box['width'] * (0.35 + q * 0.022),
            box['y'] + box['height'] * (0.4 + math.sin(q * 0.8) * 0.04),
            steps=3
        )
    page.mouse.up()
    page.wait_for_timeout(700)
    status = page.locator('.viewer-status').inner_text()
    print('打磨后状态:', status)
    assert '打磨记录 1 笔' in status, f'打磨笔记录失败: {status}'

    # 一致性自检
    page.get_by_role('button', name=re.compile('一致性自检')).click()
    page.wait_for_timeout(500)
    toast = page.locator('.toast').last.inner_text()
    print('自检结果:', toast)
    assert '一致' in toast, f'自检未通过: {toast}'

    # 推光开关
    polish = page.get_by_role('button', name=re.compile('推光'))
    polish.click()
    page.wait_for_timeout(400)

    # 回放滑块
    slider = page.locator('input[type="range"]').last
    max_val = slider.get_attribute('max')
    print('回放滑块上限:', max_val)

    page.screenshot(path=str(SHOTS / 'grind.png'))
    page.evaluate('location.hash = "#/sheet"')
    page.wait_for_timeout(600)
    page.screenshot(path=str(SHOTS / 'sheet.png'))
    page.evaluate('location.hash = "#/list"')
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / 'list.png'))

    browser.close()

print(f'\n控制台错误 {len(errors)} 条:')
for e in errors:
    print('  ERROR -', e[:300])
print(f'控制台警告 {len(warnings)} 条:')
for w in warnings[:5]:
    print('  WARN -', w[:200])

if errors:
    sys.exit(1)
print('\n浏览器冒烟测试通过')
