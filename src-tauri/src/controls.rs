//! Controls file handling for SC Joy Mapper
//!
//! This module handles saving/loading control settings (inversion only)
//! to/from our custom .sccontrols JSON format.
//!
//! NOTE: Sensitivity curve and exponent settings are DISABLED because they do not
//! persist properly in Star Citizen. Only inversion settings are functional.
//!
//! Star Citizen does NOT import curve settings from XML files - they must be applied
//! directly to actionmaps.xml. However, even when applied directly, they don't persist
//! across game restarts. This module provides:
//! 1. Custom file format for saving/loading control configurations (inversion only)
//! 2. Functions to apply settings to actionmaps.xml

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Version of the controls file format
pub const CONTROLS_FILE_VERSION: &str = "1.0";

/// A point on a response curve
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CurvePoint {
    #[serde(rename = "in")]
    pub input: f64,
    #[serde(rename = "out")]
    pub output: f64,
}

/// Curve data for an option
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CurveData {
    #[serde(default)]
    pub points: Vec<CurvePoint>,
}

/// Settings for a single control option
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ControlOptionSettings {
    /// Whether the axis is inverted
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invert: Option<bool>,

    /// The curve mode: "exponent" or "curve"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub curve_mode: Option<String>,

    /// Exponent value (used when curve_mode is "exponent")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exponent: Option<f64>,

    /// Custom curve points (used when curve_mode is "curve")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub curve: Option<CurveData>,
}

/// Settings for a specific device instance
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceInstanceSettings {
    /// The Product string for this device (for identification)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,

    /// Control options for this device instance
    /// Key is the option name (e.g., "flight_move_pitch")
    pub options: HashMap<String, ControlOptionSettings>,
}

/// Settings for all joystick instances (for future use)
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct JoystickSettings {
    /// Map of instance number (as string) to settings
    #[serde(flatten)]
    pub instances: HashMap<String, DeviceInstanceSettings>,
}

/// All device settings
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DeviceSettings {
    #[serde(default)]
    pub keyboard: Option<DeviceInstanceSettings>,

    #[serde(default)]
    pub gamepad: Option<DeviceInstanceSettings>,

    #[serde(default)]
    pub joystick: Option<HashMap<String, DeviceInstanceSettings>>,
}

/// The main controls file structure
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ControlsFile {
    /// File format version
    pub version: String,

    /// Profile name for display
    pub profile_name: String,

    /// ISO timestamp of last modification
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,

    /// Device-specific settings
    pub devices: DeviceSettings,
}

impl ControlsFile {
    /// Create a new empty controls file
    pub fn new(profile_name: String) -> Self {
        ControlsFile {
            version: CONTROLS_FILE_VERSION.to_string(),
            profile_name,
            last_modified: Some(chrono::Utc::now().to_rfc3339()),
            devices: DeviceSettings::default(),
        }
    }

    /// Parse controls file from JSON string
    pub fn from_json(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| format!("Failed to parse controls file: {}", e))
    }

    /// Serialize controls file to JSON string
    pub fn to_json(&self) -> Result<String, String> {
        serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize controls file: {}", e))
    }

    /// Update the last_modified timestamp to now (for future use)
    #[allow(dead_code)]
    pub fn touch(&mut self) {
        self.last_modified = Some(chrono::Utc::now().to_rfc3339());
    }
}

/// Input from the frontend for saving controls
#[derive(Debug, Deserialize)]
pub struct SaveControlsInput {
    pub profile_name: String,
    pub devices: DeviceSettingsInput,
}

/// Device settings input from frontend
#[derive(Debug, Deserialize)]
pub struct DeviceSettingsInput {
    #[serde(default)]
    pub keyboard: Option<HashMap<String, ControlOptionInput>>,

    #[serde(default)]
    pub gamepad: Option<HashMap<String, ControlOptionInput>>,

    #[serde(default)]
    pub joystick: Option<HashMap<String, HashMap<String, ControlOptionInput>>>,
}

/// Control option input from frontend
#[derive(Debug, Deserialize)]
pub struct ControlOptionInput {
    #[serde(default)]
    pub invert: Option<bool>,

    #[serde(default, rename = "curveMode")]
    pub curve_mode: Option<String>,

    #[serde(default)]
    pub exponent: Option<f64>,

    #[serde(default)]
    pub curve: Option<CurveInput>,
}

/// Curve input from frontend
#[derive(Debug, Deserialize)]
pub struct CurveInput {
    #[serde(default)]
    pub points: Vec<CurvePointInput>,
}

/// Curve point input from frontend
#[derive(Debug, Deserialize)]
pub struct CurvePointInput {
    #[serde(rename = "in")]
    pub input: f64,
    #[serde(rename = "out")]
    pub output: f64,
}

impl From<SaveControlsInput> for ControlsFile {
    fn from(input: SaveControlsInput) -> Self {
        let mut file = ControlsFile::new(input.profile_name);

        // Convert keyboard settings
        if let Some(keyboard_opts) = input.devices.keyboard {
            let options = convert_options_map(keyboard_opts);
            if !options.is_empty() {
                file.devices.keyboard = Some(DeviceInstanceSettings {
                    product: None,
                    options,
                });
            }
        }

        // Convert gamepad settings
        if let Some(gamepad_opts) = input.devices.gamepad {
            let options = convert_options_map(gamepad_opts);
            if !options.is_empty() {
                file.devices.gamepad = Some(DeviceInstanceSettings {
                    product: None,
                    options,
                });
            }
        }

        // Convert joystick settings
        if let Some(joystick_instances) = input.devices.joystick {
            let mut instances = HashMap::new();
            for (instance_num, opts) in joystick_instances {
                let options = convert_options_map(opts);
                if !options.is_empty() {
                    instances.insert(
                        instance_num,
                        DeviceInstanceSettings {
                            product: None,
                            options,
                        },
                    );
                }
            }
            if !instances.is_empty() {
                file.devices.joystick = Some(instances);
            }
        }

        file
    }
}

/// Convert frontend options map to our internal format
fn convert_options_map(
    opts: HashMap<String, ControlOptionInput>,
) -> HashMap<String, ControlOptionSettings> {
    let mut result = HashMap::new();

    for (name, opt) in opts {
        let settings = ControlOptionSettings {
            invert: opt.invert,
            curve_mode: opt.curve_mode,
            exponent: opt.exponent,
            curve: opt.curve.map(|c| CurveData {
                points: c
                    .points
                    .into_iter()
                    .map(|p| CurvePoint {
                        input: p.input,
                        output: p.output,
                    })
                    .collect(),
            }),
        };

        // Only add if there's at least one non-None field
        if settings.invert.is_some()
            || settings.curve_mode.is_some()
            || settings.exponent.is_some()
            || settings.curve.is_some()
        {
            result.insert(name, settings);
        }
    }

    result
}

/// Output format for loading controls (matches frontend expectations)
#[derive(Debug, Serialize)]
pub struct LoadControlsOutput {
    pub version: String,
    pub profile_name: String,
    pub last_modified: Option<String>,
    pub devices: DeviceSettingsOutput,
}

#[derive(Debug, Serialize)]
pub struct DeviceSettingsOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyboard: Option<HashMap<String, ControlOptionOutput>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub gamepad: Option<HashMap<String, ControlOptionOutput>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub joystick: Option<HashMap<String, HashMap<String, ControlOptionOutput>>>,
}

#[derive(Debug, Serialize)]
pub struct ControlOptionOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invert: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none", rename = "curveMode")]
    pub curve_mode: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub exponent: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub curve: Option<CurveOutputData>,
}

#[derive(Debug, Serialize)]
pub struct CurveOutputData {
    pub points: Vec<CurvePointOutput>,
}

#[derive(Debug, Serialize)]
pub struct CurvePointOutput {
    #[serde(rename = "in")]
    pub input: f64,
    #[serde(rename = "out")]
    pub output: f64,
}

impl From<ControlsFile> for LoadControlsOutput {
    fn from(file: ControlsFile) -> Self {
        LoadControlsOutput {
            version: file.version,
            profile_name: file.profile_name,
            last_modified: file.last_modified,
            devices: DeviceSettingsOutput {
                keyboard: file.devices.keyboard.map(convert_device_to_output),
                gamepad: file.devices.gamepad.map(convert_device_to_output),
                joystick: file.devices.joystick.map(|instances| {
                    instances
                        .into_iter()
                        .map(|(k, v)| (k, convert_device_to_output(v)))
                        .collect()
                }),
            },
        }
    }
}

fn convert_device_to_output(
    device: DeviceInstanceSettings,
) -> HashMap<String, ControlOptionOutput> {
    device
        .options
        .into_iter()
        .map(|(name, settings)| {
            (
                name,
                ControlOptionOutput {
                    invert: settings.invert,
                    curve_mode: settings.curve_mode,
                    exponent: settings.exponent,
                    curve: settings.curve.map(|c| CurveOutputData {
                        points: c
                            .points
                            .into_iter()
                            .map(|p| CurvePointOutput {
                                input: p.input,
                                output: p.output,
                            })
                            .collect(),
                    }),
                },
            )
        })
        .collect()
}

// ============================================================================
// actionmaps.xml modification functions
// ============================================================================

/// Result of applying controls to actionmaps.xml
#[derive(Debug, Serialize)]
pub struct ApplyControlsResult {
    pub success: bool,
    pub backup_path: Option<String>,
    pub message: String,
}

/// Parse the actionmaps.xml file and extract current control options
pub fn parse_actionmaps_options(xml: &str) -> Result<Vec<ActionmapsDeviceOptions>, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut devices = Vec::new();
    let mut current_device: Option<ActionmapsDeviceOptions> = None;
    let mut current_option: Option<ActionmapsControlOption> = None;
    let mut in_curve = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"options" => {
                        let mut device_type = String::new();
                        let mut instance = String::new();
                        let mut product = String::new();

                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"type" => {
                                    device_type = String::from_utf8_lossy(&attr.value).into_owned();
                                }
                                b"instance" => {
                                    instance = String::from_utf8_lossy(&attr.value).into_owned();
                                }
                                b"Product" => {
                                    product = String::from_utf8_lossy(&attr.value).into_owned();
                                }
                                _ => {}
                            }
                        }

                        current_device = Some(ActionmapsDeviceOptions {
                            device_type,
                            instance,
                            product,
                            options: Vec::new(),
                        });
                    }
                    b"nonlinearity_curve" => {
                        in_curve = true;
                    }
                    _ if current_device.is_some() && !in_curve => {
                        // This is a control option element
                        let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                        let mut attributes = Vec::new();

                        for attr in e.attributes().flatten() {
                            let key = String::from_utf8_lossy(attr.key.as_ref()).into_owned();
                            let value = String::from_utf8_lossy(&attr.value).into_owned();
                            attributes.push((key, value));
                        }

                        current_option = Some(ActionmapsControlOption {
                            name,
                            attributes,
                            curve_points: Vec::new(),
                        });
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                match e.name().as_ref() {
                    b"options" => {
                        // Self-closing options tag
                        let mut device_type = String::new();
                        let mut instance = String::new();
                        let mut product = String::new();

                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"type" => {
                                    device_type = String::from_utf8_lossy(&attr.value).into_owned();
                                }
                                b"instance" => {
                                    instance = String::from_utf8_lossy(&attr.value).into_owned();
                                }
                                b"Product" => {
                                    product = String::from_utf8_lossy(&attr.value).into_owned();
                                }
                                _ => {}
                            }
                        }

                        devices.push(ActionmapsDeviceOptions {
                            device_type,
                            instance,
                            product,
                            options: Vec::new(),
                        });
                    }
                    b"point" if in_curve => {
                        if let Some(ref mut opt) = current_option {
                            let mut in_val = String::new();
                            let mut out_val = String::new();

                            for attr in e.attributes().flatten() {
                                match attr.key.as_ref() {
                                    b"in" => {
                                        in_val = String::from_utf8_lossy(&attr.value).into_owned();
                                    }
                                    b"out" => {
                                        out_val = String::from_utf8_lossy(&attr.value).into_owned();
                                    }
                                    _ => {}
                                }
                            }

                            opt.curve_points
                                .push(ActionmapsCurvePoint { in_val, out_val });
                        }
                    }
                    _ if current_device.is_some() && !in_curve => {
                        // Self-closing control option
                        let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                        let mut attributes = Vec::new();

                        for attr in e.attributes().flatten() {
                            let key = String::from_utf8_lossy(attr.key.as_ref()).into_owned();
                            let value = String::from_utf8_lossy(&attr.value).into_owned();
                            attributes.push((key, value));
                        }

                        if let Some(ref mut device) = current_device {
                            device.options.push(ActionmapsControlOption {
                                name,
                                attributes,
                                curve_points: Vec::new(),
                            });
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                match e.name().as_ref() {
                    b"options" => {
                        if let Some(device) = current_device.take() {
                            devices.push(device);
                        }
                    }
                    b"nonlinearity_curve" => {
                        in_curve = false;
                    }
                    _ if current_option.is_some() && !in_curve => {
                        // End of a control option with children
                        if let Some(opt) = current_option.take() {
                            if let Some(ref mut device) = current_device {
                                device.options.push(opt);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(devices)
}

/// Device options from actionmaps.xml
#[derive(Debug, Clone, Serialize)]
pub struct ActionmapsDeviceOptions {
    pub device_type: String,
    pub instance: String,
    pub product: String,
    pub options: Vec<ActionmapsControlOption>,
}

/// A control option from actionmaps.xml
#[derive(Debug, Clone, Serialize)]
pub struct ActionmapsControlOption {
    pub name: String,
    pub attributes: Vec<(String, String)>,
    pub curve_points: Vec<ActionmapsCurvePoint>,
}

/// A curve point from actionmaps.xml
#[derive(Debug, Clone, Serialize)]
pub struct ActionmapsCurvePoint {
    pub in_val: String,
    pub out_val: String,
}

/// Generate XML string for an options element with control settings
pub fn generate_options_xml(device: &ActionmapsDeviceOptions) -> String {
    let mut xml = String::new();

    if device.options.is_empty() {
        // Self-closing tag
        xml.push_str(&format!(
            "  <options type=\"{}\" instance=\"{}\"",
            device.device_type, device.instance
        ));
        if !device.product.is_empty() {
            xml.push_str(&format!(" Product=\"{}\"", device.product));
        }
        xml.push_str("/>\n");
    } else {
        // Opening tag
        xml.push_str(&format!(
            "  <options type=\"{}\" instance=\"{}\"",
            device.device_type, device.instance
        ));
        if !device.product.is_empty() {
            xml.push_str(&format!(" Product=\"{}\"", device.product));
        }
        xml.push_str(">\n");

        // Control options
        for opt in &device.options {
            xml.push_str(&format!("   <{}", opt.name));

            // Attributes
            for (key, value) in &opt.attributes {
                xml.push_str(&format!(" {}=\"{}\"", key, value));
            }

            if opt.curve_points.is_empty() {
                xml.push_str("/>\n");
            } else {
                xml.push_str(">\n");
                xml.push_str("    <nonlinearity_curve>\n");
                for point in &opt.curve_points {
                    xml.push_str(&format!(
                        "     <point in=\"{}\" out=\"{}\"/>\n",
                        point.in_val, point.out_val
                    ));
                }
                xml.push_str("    </nonlinearity_curve>\n");
                xml.push_str(&format!("   </{}>\n", opt.name));
            }
        }

        xml.push_str("  </options>\n");
    }

    xml
}

/// Convert our ControlsFile format to ActionmapsDeviceOptions for writing
pub fn controls_to_actionmaps(controls: &ControlsFile) -> Vec<ActionmapsDeviceOptions> {
    let mut result = Vec::new();

    // Convert keyboard
    if let Some(ref keyboard) = controls.devices.keyboard {
        let options = convert_options_to_actionmaps(&keyboard.options);
        if !options.is_empty() {
            result.push(ActionmapsDeviceOptions {
                device_type: "keyboard".to_string(),
                instance: "1".to_string(),
                product: keyboard.product.clone().unwrap_or_default(),
                options,
            });
        }
    }

    // Convert gamepad
    if let Some(ref gamepad) = controls.devices.gamepad {
        let options = convert_options_to_actionmaps(&gamepad.options);
        if !options.is_empty() {
            result.push(ActionmapsDeviceOptions {
                device_type: "gamepad".to_string(),
                instance: "1".to_string(),
                product: gamepad.product.clone().unwrap_or_default(),
                options,
            });
        }
    }

    // Convert joysticks
    if let Some(ref joysticks) = controls.devices.joystick {
        for (instance, settings) in joysticks {
            let options = convert_options_to_actionmaps(&settings.options);
            if !options.is_empty() {
                result.push(ActionmapsDeviceOptions {
                    device_type: "joystick".to_string(),
                    instance: instance.clone(),
                    product: settings.product.clone().unwrap_or_default(),
                    options,
                });
            }
        }
    }

    result
}

fn convert_options_to_actionmaps(
    options: &HashMap<String, ControlOptionSettings>,
) -> Vec<ActionmapsControlOption> {
    options
        .iter()
        .map(|(name, settings)| {
            let mut attributes = Vec::new();
            let curve_points = Vec::new();

            // Only add invert attribute - curve/exponent are disabled
            // because they don't persist in Star Citizen
            if let Some(invert) = settings.invert {
                attributes.push((
                    "invert".to_string(),
                    if invert { "1" } else { "0" }.to_string(),
                ));
            }

            // NOTE: Curve and exponent settings are intentionally skipped
            // They don't persist properly in Star Citizen, even when written to actionmaps.xml

            ActionmapsControlOption {
                name: name.clone(),
                attributes,
                curve_points,
            }
        })
        .filter(|opt| !opt.attributes.is_empty() || !opt.curve_points.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_controls_file_serialization() {
        let mut file = ControlsFile::new("Test Profile".to_string());

        let mut options = HashMap::new();
        options.insert(
            "flight_move_pitch".to_string(),
            ControlOptionSettings {
                invert: Some(true),
                curve_mode: Some("exponent".to_string()),
                exponent: Some(1.5),
                curve: None,
            },
        );

        file.devices.joystick = Some({
            let mut instances = HashMap::new();
            instances.insert(
                "1".to_string(),
                DeviceInstanceSettings {
                    product: Some("VKB Gladiator NXT".to_string()),
                    options,
                },
            );
            instances
        });

        let json = file.to_json().unwrap();
        println!("{}", json);

        let parsed = ControlsFile::from_json(&json).unwrap();
        assert_eq!(parsed.profile_name, "Test Profile");
        assert_eq!(parsed.version, CONTROLS_FILE_VERSION);
    }
}
