#!/usr/bin/env python3
"""확장 아이콘 생성 스크립트.

의존성: Pillow

    python3 assets/icons/make-icons.py            # 채택안(N)을 src/icon.png 로 생성
    python3 assets/icons/make-icons.py --all      # 시안 전체를 candidates/ 에 생성

아이콘은 '숏폼 영상을 자동으로 멈춘다'는 동작을 일시정지 바로,
'채널을 블랙리스트에 추가한다'는 조작을 우하단 + 배지로 표현한다.

색은 빨강을 피한다. 유튜브 로고의 식별 요소는 '빨간 둥근 사각형 + 흰 삼각형'의
조합이라 일시정지 바를 쓰면 형태는 겹치지 않지만, 유튜브 관련 확장이 유튜브의
색·형태를 그대로 쓰면 공식 제품으로 오인될 여지가 커진다. 오렌지는 차단
오버레이 색(rgba(230,126,34))과 맞춘 것이다.
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFilter

SIZE = 128
SCALE = 8                      # 안티앨리어싱용 배율
W = SIZE * SCALE

WHITE = (255, 255, 255, 255)
RED = ((240, 68, 56), (193, 18, 22))
ORANGE = ((243, 156, 62), (214, 106, 20))
CHARCOAL = ((58, 62, 70), (26, 28, 33))
SLATE_FLAT = (31, 41, 51, 255)
CHAR_FLAT = (38, 38, 42, 255)
ORANGE_FLAT = (230, 126, 34, 255)


def _vertical_gradient(size, top, bottom):
    grad = Image.new('RGB', (1, size))
    draw = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(size - 1, 1)
        draw.point((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return grad.resize((size, size), Image.BILINEAR)


def _pause_bars(draw, color, cx, cy):
    bar_w, bar_h, gap = 13 * SCALE, 50 * SCALE, 10 * SCALE
    total = bar_w * 2 + gap
    x, y = cx - total // 2, cy - bar_h // 2
    radius = 4 * SCALE
    for bx in (x, x + bar_w + gap):
        draw.rounded_rectangle([bx, y, bx + bar_w, y + bar_h], radius=radius, fill=color)


def _badge(img, fill, sign_color, sign='plus'):
    """우하단 + 배지. 16px 로 줄여도 남도록 크게 잡고 본체와 분리한다."""
    r = 27 * SCALE
    cx = cy = W - r - 2 * SCALE

    shadow = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        [cx - r, cy - r + 2 * SCALE, cx + r, cy + r + 2 * SCALE], fill=(0, 0, 0, 110))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(3 * SCALE)))

    draw = ImageDraw.Draw(img)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
    arm, thick = 15 * SCALE, 4 * SCALE
    draw.rounded_rectangle([cx - arm, cy - thick, cx + arm, cy + thick],
                           radius=thick, fill=sign_color)
    if sign == 'plus':
        draw.rounded_rectangle([cx - thick, cy - arm, cx + thick, cy + arm],
                               radius=thick, fill=sign_color)
    return img


def render(gradient=None, flat_bg=None, bar=WHITE,
           badge_fill=None, badge_sign=None, sign='plus'):
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    inset = 6 * SCALE if badge_fill else 0
    body = [0, 0, W - 1 - inset, W - 1 - inset]
    radius = 24 * SCALE

    if gradient:
        shadow = Image.new('RGBA', (W, W), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            [body[0], body[1] + 4 * SCALE, body[2], body[3] + 4 * SCALE],
            radius=radius, fill=(0, 0, 0, 90))
        img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(5 * SCALE)))

        mask = Image.new('L', (W, W), 0)
        ImageDraw.Draw(mask).rounded_rectangle(body, radius=radius, fill=255)
        img.paste(_vertical_gradient(W, *gradient).convert('RGBA'), (0, 0), mask)

        highlight = Image.new('RGBA', (W, W), (0, 0, 0, 0))
        ImageDraw.Draw(highlight).rounded_rectangle(
            [body[0] + 3 * SCALE, body[1] + 3 * SCALE, body[2] - 3 * SCALE, body[1] + 34 * SCALE],
            radius=18 * SCALE, fill=(255, 255, 255, 46))
        img = Image.alpha_composite(img, highlight.filter(ImageFilter.GaussianBlur(3 * SCALE)))
    else:
        ImageDraw.Draw(img).rounded_rectangle(body, radius=radius, fill=flat_bg)

    center = (W - inset) // 2
    _pause_bars(ImageDraw.Draw(img), bar, center, center)

    if badge_fill:
        img = _badge(img, badge_fill, badge_sign, sign)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


# 채택안: 차콜 그라데이션 + 오렌지 바 + 흰 배지
FINAL = dict(gradient=CHARCOAL, bar=(233, 132, 42, 255),
             badge_fill=WHITE, badge_sign=(40, 43, 49, 255))

CANDIDATES = {
    'F': dict(flat_bg=CHAR_FLAT, bar=ORANGE_FLAT),
    'H': dict(flat_bg=CHAR_FLAT, bar=ORANGE_FLAT, badge_fill=WHITE, badge_sign=CHAR_FLAT),
    'I': dict(flat_bg=SLATE_FLAT, bar=WHITE, badge_fill=ORANGE_FLAT, badge_sign=WHITE),
    'K': dict(flat_bg=CHAR_FLAT, bar=ORANGE_FLAT, badge_fill=WHITE,
              badge_sign=CHAR_FLAT, sign='minus'),
    'L': dict(gradient=RED, bar=WHITE, badge_fill=WHITE, badge_sign=(198, 24, 26, 255)),
    'M': dict(gradient=ORANGE, bar=WHITE, badge_fill=WHITE, badge_sign=(203, 100, 18, 255)),
    'N': FINAL,
    'O': dict(gradient=CHARCOAL, bar=WHITE, badge_fill=WHITE, badge_sign=(34, 37, 43, 255)),
}

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--all', action='store_true', help='시안 전체를 candidates/ 에 생성')
    args = ap.parse_args()

    if args.all:
        out = os.path.join(HERE, 'candidates')
        os.makedirs(out, exist_ok=True)
        for key, kwargs in CANDIDATES.items():
            render(**kwargs).save(os.path.join(out, f'icon-{key}.png'))
        print(f'시안 {len(CANDIDATES)}개 생성: {out}')

    icon = render(**FINAL)
    icon.save(os.path.join(ROOT, 'src', 'icon.png'))
    icon.save(os.path.join(HERE, 'icon.png'))
    print('채택안(N) 적용: src/icon.png')


if __name__ == '__main__':
    main()
