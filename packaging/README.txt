UNO WITH A LADDER - DB5 EDITION
===============================

A racing game in a single HTML file that draws on your graphics card with WebGPU.
Three cars: a 1964 Aston Martin DB5 in Silver Birch and a 1987 Aston Martin V8 Vantage
in Cumberland Grey, both with film-style gadgets, and the original 1996 Fiat Uno Mille EP
with a ladder on the roof. Two maps: the Serra da Mata mountain circuit, and
Weston-super-Mare, built from OpenStreetMap - a 3.5 km street circuit along the seafront,
and the rest of the town to drive around freely.
Pick the car and the map on the start screen (press Esc for the menu).


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

V8 Vantage gadgets
  G (hold)          hubcap lasers               (B, hold)
  K                 missiles from behind the driving lamps, two per load (D-pad up)
  T                 spiked tyres                (D-pad right)
  U                 outrigger skis              (Back)
  J                 rocket booster: 3 s of thrust, then 15 s to recharge (LB)
  E (hold 2 s)      self-destruct (the car comes back on the track) (R3, hold)
  Q (hold)          horn                        (L3, hold)
  L                 headlamps
  The head-up display shows in the cockpit view while the weapons are in use.

Other
  M  sound on/off     H  performance stats     B  benchmark lap
  F  watch the demo lap      1 to 6  fixed camera views
Automatic gearbox. A lap counts when you cross the start line.


MACOS AND LINUX
---------------
macOS: double-click  Play-macOS.command  (the first time: right-click > Open).
Linux: run  ./Play-Linux.sh  (add  --install  to put it in your applications menu).


ABOUT THE CARS AND THE MAP
--------------------------
The DB5 and the V8 Vantage were modelled in Blender from measured data. DB5: FIA
homologation form no. 186 (wheelbase 2489 mm, 3995 cc straight-six, 282 bhp, ZF
five-speed). V8 Vantage: a scale drawing and published figures (wheelbase 2610 mm,
5340 cc V8 with four Weber carburettors, about 400 bhp, ZF five-speed, 255/60 VR15
tyres). Every engine and gadget sound is synthesised live as you drive.
Weston-super-Mare is built from OpenStreetMap (streets and building footprints) and
elevation data; the street circuit runs Royal Parade, Knightstone Road, the Boulevard,
Alexandra Parade, Station Road, Walliscote Road and back along Beach Road.

Credits
- Body proportions were measured from the "1965 Aston Martin DB5 Coupe" and
  "1983 Aston Martin V8 Vantage" blueprints by getoutlines.com, licensed CC BY 4.0:
  https://getoutlines.com/blueprints/12592/1965-aston-martin-db5-coupe-blueprints
  https://getoutlines.com/blueprints/13815/1983-aston-martin-v8-vantage-coupe-blueprints
- Weston-super-Mare: map data (c) OpenStreetMap contributors, ODbL
  (https://www.openstreetmap.org/copyright). Contains Environment Agency information
  (c) Environment Agency and/or database right (LIDAR, Open Government Licence v3.0).
  Terrain: AWS Terrain Tiles (Mapzen/Tilezen) - UK terrain data (c) Environment Agency
  copyright and/or database right 2015; SRTM and GMTED2010 courtesy of the U.S.
  Geological Survey; ETOPO1 from NOAA; EU-DEM produced using Copernicus data.
- The game engine, the circuit and the Fiat Uno come from the original
  "Uno com Escada" game (see LICENSE.md: PolyForm Noncommercial 1.0.0).

This is an unofficial, non-commercial fan project. Aston Martin, DB5 and Vantage are trademarks
of Aston Martin Lagonda Ltd; the project is not affiliated with or endorsed by
Aston Martin or by the makers of the James Bond films.
