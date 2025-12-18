# Controls System Design Document

## Overview

This document describes the controls system for the SC Joy Mapper application, which handles sensitivity curves, exponent values, and inversion settings for Star Citizen input devices.

## Important Discovery

**Star Citizen does NOT export or import curve settings through the XML keybinding files!**

When exporting keybindings from Star Citizen:
- Curve settings (`nonlinearity_curve`, `exponent`) are NOT included
- Only `invert` settings are exported

When importing keybindings into Star Citizen:
- Curve settings are IGNORED
- Only keybind assignments are imported

The ONLY way to modify curve settings is by directly editing the `actionmaps.xml` file in the Star Citizen user profile directory.

## Current Implementation (XML Export Format)

### XML Structure for Control Options

Control options are stored within `<options>` elements in the keybinding XML:

```xml
<ActionMaps version="1" optionsVersion="2" rebindVersion="2" profileName="my_profile">
  <!-- Device options with control settings -->
  <options type="joystick" instance="1" Product="VKB-Sim Gladiator NXT R">
    <!-- Simple invert setting -->
    <flight_move_pitch invert="1"/>
    
    <!-- Exponent only (no curve) -->
    <flight_move_yaw exponent="1.5"/>
    
    <!-- Curve with points -->
    <flight_move_roll exponent="1">
      <nonlinearity_curve>
        <point in="0" out="0"/>
        <point in="0.2" out="0.05"/>
        <point in="0.5" out="0.25"/>
        <point in="1" out="1"/>
      </nonlinearity_curve>
    </flight_move_roll>
  </options>
  
  <options type="joystick" instance="2" Product="VKB-Sim Gladiator NXT L">
    <!-- Settings for second joystick -->
  </options>
  
  <options type="keyboard" instance="1" Product="Keyboard {6F1D2B61-D5A0-11CF-BFC7-444553540000}"/>
  
  <!-- ... actionmaps with rebinds ... -->
</ActionMaps>
```

### Option Element Attributes

- **name**: The control option identifier (e.g., `flight_move_pitch`, `fps_view_yaw`)
- **invert**: `"1"` for inverted, `"0"` or absent for normal
- **exponent**: Float value for response curve (1.0 = linear, >1 = less sensitive at start)

### Curve Points

When using custom curves instead of simple exponent:
- `<nonlinearity_curve>` contains multiple `<point>` elements
- Each point has:
  - `in`: Input value (0.0 to 1.0)
  - `out`: Output value (0.0 to 1.0)
- Points are interpolated linearly between defined values

## Star Citizen File Locations

### Exported Keybinding Files
- Location: User-selected directory
- Filename: `layout_*.xml` (e.g., `layout_exported.xml`)
- **Does NOT contain curve settings**

### Active Game Settings (actionmaps.xml)
- Location: `<SC Install>\user\client\0\Profiles\default\actionmaps.xml`
- **Contains actual curve settings**
- Must edit directly to change curves
- Changes require game restart

## New System Design

### Custom Controls File Format

Since SC doesn't import curve settings, we need our own file format. Using JSON for flexibility:

```json
{
  "version": "1.0",
  "profileName": "My Controls",
  "lastModified": "2024-12-04T12:00:00Z",
  "devices": {
    "keyboard": {
      "instance": 1,
      "options": {}
    },
    "gamepad": {
      "instance": 1,
      "options": {}
    },
    "joystick": {
      "1": {
        "product": "VKB-Sim Gladiator NXT R",
        "options": {
          "flight_move_pitch": {
            "invert": true,
            "curveMode": "exponent",
            "exponent": 1.5
          },
          "flight_move_roll": {
            "invert": false,
            "curveMode": "curve",
            "curve": {
              "points": [
                {"in": 0.0, "out": 0.0},
                {"in": 0.2, "out": 0.05},
                {"in": 0.5, "out": 0.25},
                {"in": 1.0, "out": 1.0}
              ]
            }
          }
        }
      },
      "2": {
        "product": "VKB-Sim Gladiator NXT L",
        "options": {}
      }
    }
  }
}
```

### File Extension
- `.sccontrols` - Custom extension for SC Joy Mapper control settings

### Workflow

1. **Save Controls**:
   - User configures curves/exponent/invert in Controls Editor
   - Settings saved to `.sccontrols` file (our format)
   - No changes to keybinding XML files

2. **Apply to Star Citizen**:
   - User clicks "Apply to Star Citizen" button
   - Show confirmation: "This will modify actionmaps.xml directly. Changes require a game restart."
   - Parse user's current `actionmaps.xml`
   - Merge our control options into the `<options>` elements
   - Write updated `actionmaps.xml`
   - Backup original file first!

3. **Load Controls**:
   - Load from `.sccontrols` file
   - OR import from existing `actionmaps.xml` (read current SC settings)

## Implementation Tasks

### Phase 1: Custom File Format
- [ ] Create Rust structs for JSON controls format
- [ ] Implement save/load commands for `.sccontrols` files
- [ ] Update frontend to use new save/load system
- [ ] Remove control options from keybindings XML export

### Phase 2: Apply to actionmaps.xml
- [ ] Create parser for actionmaps.xml structure
- [ ] Implement merge logic for `<options>` elements
- [ ] Add backup system before modifications
- [ ] Create confirmation dialog
- [ ] Test with various SC installation paths

### Phase 3: Import from actionmaps.xml
- [ ] Parse existing control options from actionmaps.xml
- [ ] Convert to our internal format
- [ ] Allow importing as starting point

## Safety Considerations

1. **Always Backup**: Before modifying actionmaps.xml, create a timestamped backup
2. **Validate XML**: Ensure generated XML is valid before writing
3. **Preserve Structure**: Don't modify parts of actionmaps.xml we don't understand
4. **User Warning**: Clear messaging that this modifies game files directly

## UI Changes

### Controls Editor Tab
- Add "Save Controls" button (saves .sccontrols file)
- Add "Load Controls" button (loads .sccontrols file)
- Add "Apply to Star Citizen" button with confirmation
- Add "Import from Star Citizen" button (reads actionmaps.xml)
- Show current file path
- Unsaved changes indicator

### Toolbar
- Separate controls save/load from keybindings save/load
- Or: Unified save that saves both to their respective locations
