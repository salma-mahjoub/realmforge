from pathlib import Path
root=Path(__file__).resolve().parents[1]/'sources'/'custom';root.mkdir(parents=True,exist_ok=True)
def svg(name,body,w=64,h=64):
 (root/(name+'.svg')).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><!-- RealmForge original, CC0-1.0 -->{body}</svg>\n')
steel='#667789'; dark='#344354'; light='#c4d9e5'; orange='#ffbc5e'
beam='<rect x="2" y="20" width="60" height="16" rx="5" fill="#b77a4e"/><path d="M6 25H58M15 22V33M48 22V33" stroke="#e6b77d" stroke-width="3"/>'
svg('seesaw',f'<path d="M22 60L32 34L42 60Z" fill="{steel}"/>'+beam+f'<circle cx="32" cy="38" r="5" fill="{dark}"/>')
svg('chain_bridge',''.join(f'<rect x="{i}" y="28" width="15" height="9" rx="4" fill="none" stroke="{steel}" stroke-width="4"/>' for i in range(1,58,11)))
svg('pendulum_ball',f'<circle cx="32" cy="32" r="28" fill="{dark}"/><circle cx="28" cy="26" r="22" fill="{steel}"/><path d="M15 25Q16 14 29 13" fill="none" stroke="{light}" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="6" r="5" fill="{dark}"/>')
svg('conveyor_belt',f'<rect x="1" y="20" width="62" height="24" rx="12" fill="{dark}"/><path d="M13 22H51M13 42H51" stroke="{steel}" stroke-width="3"/>'+''.join(f'<circle cx="{x}" cy="32" r="7" fill="{steel}"/><circle cx="{x}" cy="32" r="2" fill="{light}"/>' for x in [13,32,51])+f'<path d="M21 12L27 16L21 20M36 12L42 16L36 20" fill="none" stroke="{orange}" stroke-width="3"/>')
for name,symbol in [('moving_platform','M9 12H55M49 7L55 12L49 17M15 7L9 12L15 17'),('elevator','M32 2V17M27 7L32 2L37 7M27 12L32 17L37 12'),('rotating_platform','M15 12Q32 -1 49 12M43 7L49 12L44 17')]:
 svg(name,beam+f'<path d="{symbol}" fill="none" stroke="{steel}" stroke-width="3" stroke-linecap="round"/>')
svg('ice','<rect x="1" y="1" width="62" height="62" rx="5" fill="#92dfea"/><path d="M2 9H62M8 3V59M25 5L4 26M52 6L8 50M60 31L32 59" stroke="#e1fbff" stroke-width="5" opacity=".7"/><path d="M1 57H63V63H1Z" fill="#55b7d6"/>')
svg('slime','<rect x="1" y="10" width="62" height="53" rx="4" fill="#4d8b42"/><path d="M1 18V7Q8 0 15 7Q22 0 30 7Q38 0 45 7Q55 0 63 7V21Q55 32 50 18Q43 9 39 28Q31 41 27 23Q23 12 17 24Q9 36 1 18Z" fill="#a3db46"/><circle cx="16" cy="11" r="3" fill="#d6f391"/><circle cx="44" cy="13" r="2" fill="#d6f391"/>')
svg('cannon','<circle cx="19" cy="51" r="11" fill="#344354"/><circle cx="47" cy="51" r="11" fill="#344354"/><path d="M12 20Q8 38 18 45H49V20Z" fill="#667789"/><rect x="42" y="15" width="17" height="32" rx="5" fill="#344354"/><ellipse cx="54" cy="31" rx="6" ry="12" fill="#202e3b"/><path d="M16 25H37" stroke="#c4d9e5" stroke-width="5" stroke-linecap="round"/>')
svg('powerup_double_jump','<circle cx="32" cy="32" r="28" fill="#bce5ff" stroke="#58a6df" stroke-width="4"/><path d="M18 31L32 17L46 31M18 44L32 30L46 44" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>')
svg('powerup_dash','<circle cx="32" cy="32" r="28" fill="#ffe6a5" stroke="#ecac45" stroke-width="4"/><path d="M34 9L18 35H30L26 55L47 28H34Z" fill="white"/>')
# Distinct toolbar symbols, transparent and scalable.
paths={'place':'M32 12V52M12 32H52','erase':'M11 38L33 12L53 30L34 52H22ZM24 24L44 43','select':'M14 9L49 34L32 37L25 54Z','rotate':'M48 22A21 21 0 1 0 49 43M48 9V23H34','properties':'M12 18H52M12 32H52M12 46H52M23 11V25M42 25V39M27 39V53','link':'M28 21L35 14A11 11 0 0 1 51 30L40 41M36 43L29 50A11 11 0 0 1 13 34L24 23M23 41L41 23','undo':'M13 26H37Q52 26 52 43M13 26L25 14M13 26L25 38','redo':'M51 26H27Q12 26 12 43M51 26L39 14M51 26L39 38','copy':'M23 10H52V43H23ZM12 22V54H40','paste':'M23 15H13V55H51V15H41M24 10H40V22H24Z','save':'M12 10H45L54 19V54H12ZM22 10V28H43V10M22 54V37H44V54','play':'M19 11L51 32L19 53Z','grid':'M11 11H53V53H11ZM25 11V53M39 11V53M11 25H53M11 39H53','delete':'M17 21L20 54H45L48 21M12 17H52M24 17V10H40V17M27 28V45M38 28V45'}
for name,p in paths.items():svg('tool_'+name,f'<path d="{p}" fill="none" stroke="#e8f2fb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>')
print('Created',len(list(root.glob('*.svg'))),'supplement SVGs (CC0).')
