UNO WITH A LADDER - DB5 EDITION
===============================

A racing game in a single HTML file that draws on your graphics card with WebGPU.
Drive a 1964 Aston Martin DB5 in Silver Birch, with its Goldfinger-style gadgets,
around the Serra da Mata circuit. You can also pick the original 1996 Fiat Uno Mille EP
with a ladder on the roof (choose the car in the menu: press Esc).


WHAT YOU NEED
-------------
- Windows 10 or 11 with Google Chrome or Microsoft Edge, version 113 or newer
  (Edge is already on every Windows 10/11 PC).
- A graphics card with up-to-date drivers.
- It also runs on macOS (Chrome, Edge or Safari 26+) and Linux (Chrome); see the end.


INSTALL ON WINDOWS
------------------
1. Right-click the zip file > "Extract All..." > Extract.
   (Don't run anything from inside the zip without extracting it first.)
2. In the extracted folder, double-click  Install.cmd
   Windows may warn you because the scripts are not signed:
   choose "Run", or "More info" > "Run anyway".
3. That's it: the game starts, and there is now an
   "Uno with a Ladder - DB5 Edition" icon on your desktop and in the Start menu.

- No admin rights are needed. The game goes to
  %LOCALAPPDATA%\Programs\Uno with a Ladder - DB5 Edition
- To play without installing, double-click  Play.cmd  instead.
- To uninstall: Settings > Apps > Installed apps > "Uno with a Ladder - DB5 Edition" >
  Uninstall (or run Uninstall.cmd in the install folder).

The game opens in its own window (a Chrome/Edge app window with no address bar).
Press F11 for full screen. Click in the window or press a key to start the sound.

Slow or choppy? Press Esc and pick "Fast graphics (laptops, older PCs)": it draws at
720p instead of your full screen resolution. The first time you play, the game also
switches to it by itself if your graphics card is too slow.

If the screen stays black or the game says WebGPU is not available:
update Chrome/Edge and your graphics driver, then open  chrome://gpu  (or  edge://gpu)
and check that it says  "WebGPU: Hardware accelerated".


CONTROLS
--------
Keyboard                              Gamepad
  W or Up arrow     throttle            right trigger   throttle
  S or Down arrow   brake / reverse     left trigger    brake / reverse
  A D or arrows     steer               left stick      steer
  Space             handbrake           A               handbrake
  C                 change camera       Y               change camera
                    (chase, bonnet, cockpit, TV)
  V (hold)          look back           RB (hold)       look back
  R                 back on track       X               back on track
  Esc               pause / menu        Start           pause / menu

DB5 gadgets
  P                 revolving number plates     (D-pad left)
  G (hold)          machine guns                (B, hold)
  K                 rear bullet shield          (D-pad up)
  T                 tyre slashers               (D-pad right)
  U                 bumper rams                 (Back)
  J                 smoke screen                (LB)
  O (hold)          oil slick                   (D-pad down, hold)
  E                 ejector seat                (R3)
  Q (hold)          horn                        (L3, hold)
  L                 headlamps

Other
  M  sound on/off     H  performance stats     B  benchmark lap
  F  watch the demo lap      1 to 6  fixed camera views
Automatic gearbox. A lap counts when you cross the start line.


MACOS AND LINUX
---------------
macOS: double-click  Play-macOS.command  (the first time: right-click > Open).
Linux: run  ./Play-Linux.sh  (add  --install  to put it in your applications menu).


ABOUT THE CAR
-------------
The DB5 was modelled in Blender from measured data: the FIA homologation form no. 186
(wheelbase 2489 mm, tracks 1378/1359 mm, length 4572 mm, width 1676 mm, 6.70x15 tyres
on 15-inch wire wheels), published specifications, and scale drawings. Its physics use
the homologated figures (3995 cc straight-six, 282 bhp at 5500 rpm, ZF 5-speed gearbox,
rear-wheel drive), and all engine and gadget sounds are synthesised live as you drive.

Credits
- Body proportions were measured from the "1965 Aston Martin DB5 Coupe" blueprint
  by getoutlines.com, licensed CC BY 4.0:
  https://getoutlines.com/blueprints/12592/1965-aston-martin-db5-coupe-blueprints
- The game engine, the circuit and the Fiat Uno come from the original
  "Uno com Escada" game (see LICENSE.md: PolyForm Noncommercial 1.0.0).

This is an unofficial, non-commercial fan project. Aston Martin and DB5 are trademarks
of Aston Martin Lagonda Ltd; the project is not affiliated with or endorsed by
Aston Martin or by the makers of the James Bond films.
