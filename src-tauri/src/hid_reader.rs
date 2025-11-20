use hidapi::HidApi;
use hidreport::{Field, Report, ReportDescriptor};
use hut::Usage;
use serde::Serialize;
use std::collections::HashMap;
use std::ffi::CString;

#[derive(Serialize, Clone, Debug)]
pub struct HidDeviceListItem {
    pub vendor_id: u16,
    pub product_id: u16,
    pub serial_number: Option<String>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub path: String,
    pub interface_number: i32,
}

#[derive(Serialize, Clone, Debug)]
pub struct HidAxisReport {
    pub axis_values: HashMap<u32, u16>, // axis_id -> raw value (0-65535 for 16-bit, 0-255 for 8-bit)
    pub axis_bit_depths: HashMap<u32, u8>, // axis_id -> detected bit depth (8, 10, 11, 12, 16, etc.)
    pub axis_names: HashMap<u32, String>,  // axis_id -> HID usage name (e.g., "X", "Y", "Rz")
    pub axis_ranges: HashMap<u32, (i32, i32)>, // axis_id -> (logical_min, logical_max) from HID descriptor
    pub timestamp_ms: u64,
    pub is_16bit: bool, // Indicates if values are 16-bit (true) or 8-bit (false)
}

#[derive(Serialize, Clone, Debug)]
pub struct HidFullReport {
    pub axis_values: HashMap<u32, u16>,
    pub axis_bit_depths: HashMap<u32, u8>,
    pub axis_names: HashMap<u32, String>,
    pub axis_ranges: HashMap<u32, (i32, i32)>,
    pub pressed_buttons: Vec<u32>,
    pub timestamp_ms: u64,
    pub is_16bit: bool,
}

/// List all HID devices that appear to be game controllers
pub fn list_hid_game_controllers() -> Result<Vec<HidDeviceListItem>, String> {
    let api = HidApi::new().map_err(|e| format!("Failed to initialize HID API: {}", e))?;

    let devices: Vec<HidDeviceListItem> = api
        .device_list()
        .filter(|info| {
            // Filter for devices that are likely game controllers
            // HID Usage Page 0x01 = Generic Desktop Controls
            // HID Usage 0x04 = Joystick, 0x05 = Gamepad
            let usage_page = info.usage_page();
            let usage = info.usage();

            // Check if it's a joystick (0x04) or gamepad (0x05)
            usage_page == 0x01 && (usage == 0x04 || usage == 0x05)
        })
        .map(|info| HidDeviceListItem {
            vendor_id: info.vendor_id(),
            product_id: info.product_id(),
            serial_number: info.serial_number().map(|s| s.to_string()),
            manufacturer: info.manufacturer_string().map(|s| s.to_string()),
            product: info.product_string().map(|s| s.to_string()),
            path: info.path().to_string_lossy().to_string(),
            interface_number: info.interface_number(),
        })
        .collect();

    eprintln!("[HID] Found {} game controller devices", devices.len());

    Ok(devices)
}

/// Open a HID device and read a single report
pub fn read_hid_report(device_path: &str, timeout_ms: i32) -> Result<Vec<u8>, String> {
    let api = HidApi::new().map_err(|e| format!("Failed to initialize HID API: {}", e))?;

    // Convert Rust string to CString for hidapi
    let c_path = CString::new(device_path)
        .map_err(|e| format!("Invalid device path (contains null byte): {}", e))?;

    let device = api
        .open_path(&c_path)
        .map_err(|e| format!("Failed to open HID device: {}", e))?;

    let mut buf = [0u8; 256];
    let len = device
        .read_timeout(&mut buf, timeout_ms)
        .map_err(|e| format!("Failed to read from HID device: {}", e))?;

    if len > 0 {
        eprintln!("[HID] Read {} bytes from device", len);
        eprintln!("[HID] Raw report: {:?}", &buf[..len]);

        // Print first 16 bytes with positions for easier analysis
        if len >= 16 {
            eprint!("[HID] Bytes 0-15:  ");
            for i in 0..16 {
                eprint!("{:02X} ", buf[i]);
            }
            eprintln!();
            eprint!("[HID] Positions:   ");
            for i in 0..16 {
                eprint!("{:2} ", i);
            }
            eprintln!();
        }
    }

    Ok(buf[..len].to_vec())
}

/// Parse a HID report using a pre-fetched descriptor (recommended)
/// This avoids reopening the device on every parse
pub fn parse_hid_axes_from_descriptor_bytes(
    report: &[u8],
    descriptor: &[u8],
) -> Result<HidAxisReport, String> {
    // Parse the descriptor
    let rdesc = ReportDescriptor::try_from(descriptor)
        .map_err(|e| format!("Failed to parse report descriptor: {:?}", e))?;

    // Find the matching input report
    let input_report = rdesc
        .find_input_report(report)
        .ok_or("No matching input report found")?;

    let mut axis_values = HashMap::new();
    let mut axis_bit_depths = HashMap::new();
    let mut axis_names = HashMap::new();
    let mut axis_ranges: HashMap<u32, (i32, i32)> = HashMap::new();
    let mut max_bits = 8;

    // Extract values from each field
    for field in input_report.fields() {
        match field {
            Field::Variable(var) => {
                // Filter out buttons (Usage Page 0x09)
                if u16::from(var.usage.usage_page) == 0x09 {
                    continue;
                }

                // Extract the value based on bit size
                let bits = var.bits.end - var.bits.start;
                max_bits = max_bits.max(bits);

                // Construct usage value
                let usage_val: u32 = ((u16::from(var.usage.usage_page) as u32) << 16)
                    | (u16::from(var.usage.usage_id) as u32);

                // Use the usage ID as the axis index for consistency
                // This ensures the same axis always has the same ID regardless of descriptor order
                let axis_index = u16::from(var.usage.usage_id) as u32;

                // Extract the value
                match var.extract(report) {
                    Ok(field_value) => {
                        // FieldValue implements Into<i32>
                        let value: i32 = field_value.into();

                        // Don't clamp - keep the raw value as extracted
                        // The HID descriptor knows the correct range
                        let value_u16 = if value < 0 {
                            0
                        } else if value > u16::MAX as i32 {
                            u16::MAX
                        } else {
                            value as u16
                        };

                        // Get axis name
                        let axis_name = Usage::try_from(usage_val)
                            .ok()
                            .map(|u| u.name().to_string())
                            .unwrap_or_else(|| {
                                format!(
                                    "Usage {:04x}:{:04x}",
                                    u16::from(var.usage.usage_page),
                                    u16::from(var.usage.usage_id)
                                )
                            });

                        let logical_min = i32::from(var.logical_minimum);
                        let logical_max = i32::from(var.logical_maximum);

                        // Calculate effective bit depth from the actual range
                        // For example: range 0-4095 = 12 bits, 0-2047 = 11 bits, 0-1023 = 10 bits
                        let range = (logical_max - logical_min) as u32;
                        let effective_bits = if range > 0 {
                            32 - range.leading_zeros() // Number of bits needed to represent the range
                        } else {
                            bits as u32 // Fallback to report_size if range is invalid
                        };

                        axis_values.insert(axis_index, value_u16);
                        axis_bit_depths.insert(axis_index, effective_bits as u8);
                        axis_names.insert(axis_index, axis_name.clone());
                        axis_ranges.insert(axis_index, (logical_min, logical_max));
                        eprintln!(
                            "[HID] Axis {}: {} = {} ({} bits, effective {} bits, usage: 0x{:08X}, logical range: {} to {})",
                            axis_index, axis_name, value, bits, effective_bits, usage_val, logical_min, logical_max
                        );
                    }
                    Err(e) => {
                        eprintln!("[HID] Failed to extract axis value: {:?}", e);
                    }
                }
            }
            Field::Array(_arr) => {
                // Array fields are typically buttons, skip for axis extraction
            }
            Field::Constant(_) => {
                // Padding, skip
            }
        }
    }

    let is_16bit = max_bits > 8;

    Ok(HidAxisReport {
        axis_values,
        axis_bit_depths,
        axis_names,
        axis_ranges,
        timestamp_ms: current_time_ms(),
        is_16bit,
    })
}

/// Parse a HID report to extract BOTH axes and buttons from descriptor
/// This is the comprehensive version that returns all input data
pub fn parse_hid_full_report(report: &[u8], descriptor: &[u8]) -> Result<HidFullReport, String> {
    // Parse the descriptor
    let rdesc = ReportDescriptor::try_from(descriptor)
        .map_err(|e| format!("Failed to parse report descriptor: {:?}", e))?;

    // Find the matching input report
    let input_report = rdesc
        .find_input_report(report)
        .ok_or("No matching input report found")?;

    let mut axis_values = HashMap::new();
    let mut axis_bit_depths = HashMap::new();
    let mut axis_names = HashMap::new();
    let mut axis_ranges: HashMap<u32, (i32, i32)> = HashMap::new();
    let mut pressed_buttons = Vec::new();
    let mut max_bits = 8;
    let mut button_index: u32 = 1; // 1-based button numbering

    // Extract values from each field
    for field in input_report.fields() {
        match field {
            Field::Variable(var) => {
                let usage_page = u16::from(var.usage.usage_page);

                // Check if this is a button (Usage Page 0x09)
                if usage_page == 0x09 {
                    // This is a button
                    match var.extract(report) {
                        Ok(field_value) => {
                            let value: i32 = field_value.into();
                            if value != 0 {
                                // Button is pressed
                                pressed_buttons.push(button_index);
                                eprintln!(
                                    "[HID] Button {} pressed (value: {})",
                                    button_index, value
                                );
                            }
                            button_index += 1;
                        }
                        Err(e) => {
                            eprintln!("[HID] Failed to extract button value: {:?}", e);
                            button_index += 1;
                        }
                    }
                    continue;
                }

                // This is an axis
                let bits = var.bits.end - var.bits.start;
                max_bits = max_bits.max(bits);

                // Construct usage value
                let usage_val: u32 =
                    ((usage_page as u32) << 16) | (u16::from(var.usage.usage_id) as u32);

                // Use the usage ID as the axis index for consistency
                let axis_index = u16::from(var.usage.usage_id) as u32;

                // Extract the value
                match var.extract(report) {
                    Ok(field_value) => {
                        let value: i32 = field_value.into();
                        let value_u16 = value.max(0).min(u16::MAX as i32) as u16;

                        // Get axis name
                        let axis_name = Usage::try_from(usage_val)
                            .ok()
                            .map(|u| u.name().to_string())
                            .unwrap_or_else(|| {
                                format!(
                                    "Usage {:04x}:{:04x}",
                                    usage_page,
                                    u16::from(var.usage.usage_id)
                                )
                            });

                        let logical_min = i32::from(var.logical_minimum);
                        let logical_max = i32::from(var.logical_maximum);

                        // Calculate effective bit depth from the actual range
                        let range = (logical_max - logical_min) as u32;
                        let effective_bits = if range > 0 {
                            32 - range.leading_zeros()
                        } else {
                            bits as u32
                        };

                        axis_values.insert(axis_index, value_u16);
                        axis_bit_depths.insert(axis_index, effective_bits as u8);
                        axis_names.insert(axis_index, axis_name.clone());
                        axis_ranges.insert(axis_index, (logical_min, logical_max));
                    }
                    Err(e) => {
                        eprintln!("[HID] Failed to extract axis value: {:?}", e);
                    }
                }
            }
            Field::Array(arr) => {
                // Array fields for buttons - these typically encode multiple button states
                // Each value in the array represents a button usage ID that is pressed
                // Array fields are often used for keyboard-like button encoding
                match arr.extract(report) {
                    Ok(values) => {
                        for field_value in values {
                            let button_val: i32 = field_value.into();
                            if button_val > 0 && button_val <= 255 {
                                // Valid button press (usage ID)
                                pressed_buttons.push(button_val as u32);
                                eprintln!("[HID] Array button {} pressed", button_val);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[HID] Failed to extract array button value: {:?}", e);
                    }
                }
            }
            Field::Constant(_) => {
                // Padding, skip
            }
        }
    }

    let is_16bit = max_bits > 8;

    Ok(HidFullReport {
        axis_values,
        axis_bit_depths,
        axis_names,
        axis_ranges,
        pressed_buttons,
        timestamp_ms: current_time_ms(),
        is_16bit,
    })
}

fn current_time_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Get the raw HID report descriptor bytes from a device
/// This can be cached and reused for parsing multiple reports
pub fn get_hid_descriptor_bytes(device_path: &str) -> Result<Vec<u8>, String> {
    let api = HidApi::new().map_err(|e| format!("Failed to initialize HID API: {}", e))?;

    let c_path = CString::new(device_path).map_err(|e| format!("Invalid device path: {}", e))?;

    let device = api
        .open_path(&c_path)
        .map_err(|e| format!("Failed to open device: {}", e))?;

    // Get the report descriptor (max 4096 bytes for HID descriptors)
    let mut descriptor_buf = vec![0u8; 4096];
    let descriptor_len = device
        .get_report_descriptor(&mut descriptor_buf)
        .map_err(|e| format!("Failed to get report descriptor: {}", e))?;

    eprintln!("[HID] Report descriptor length: {} bytes", descriptor_len);
    Ok(descriptor_buf[..descriptor_len].to_vec())
}

/// Get HID axis names from the device's report descriptor using proper HID parsing libraries
/// Returns a mapping of axis index -> axis name (e.g., "X", "Y", "Rz", "Slider")
pub fn get_axis_names_from_descriptor(device_path: &str) -> Result<HashMap<u32, String>, String> {
    let descriptor = get_hid_descriptor_bytes(device_path)?;
    // Parse the descriptor using the hidreport crate
    parse_hid_descriptor_with_library(&descriptor)
}

/// Get a mapping from DirectInput axis indices (1-based sequential) to HID usage IDs
/// This is needed because DirectInput returns axes in sequential order (1, 2, 3...)
/// but HID uses usage IDs (48=X, 49=Y, 50=Z, etc.)
pub fn get_directinput_to_hid_axis_mapping(device_path: &str) -> Result<HashMap<u32, u32>, String> {
    let descriptor = get_hid_descriptor_bytes(device_path)?;

    // Parse the report descriptor
    let rdesc = ReportDescriptor::try_from(descriptor.as_slice())
        .map_err(|e| format!("Failed to parse report descriptor: {:?}", e))?;

    let mut mapping = HashMap::new();
    let mut directinput_index: u32 = 1; // DirectInput uses 1-based indexing

    // Iterate through input reports and collect axes in order
    for report in rdesc.input_reports() {
        for field in report.fields() {
            if let Field::Variable(var) = field {
                // Filter out buttons (Usage Page 0x09)
                if u16::from(var.usage.usage_page) == 0x09 {
                    continue;
                }

                // This is an axis - map DirectInput index to HID usage ID
                let usage_id = u16::from(var.usage.usage_id) as u32;
                mapping.insert(directinput_index, usage_id);

                eprintln!(
                    "[Axis Mapping] DirectInput axis {} → HID usage ID {} ({})",
                    directinput_index,
                    usage_id,
                    Usage::try_from(((u16::from(var.usage.usage_page) as u32) << 16) | usage_id)
                        .ok()
                        .map(|u| u.name().to_string())
                        .unwrap_or_else(|| "Unknown".to_string())
                );

                directinput_index += 1;
            }
        }
    }

    Ok(mapping)
}

/// Parse HID report descriptor using the hidreport crate to extract axis names
/// This replaces our manual parsing with proper library-based parsing
fn parse_hid_descriptor_with_library(descriptor: &[u8]) -> Result<HashMap<u32, String>, String> {
    let mut axis_names = HashMap::new();

    // Parse the report descriptor
    let rdesc = ReportDescriptor::try_from(descriptor)
        .map_err(|e| format!("Failed to parse report descriptor: {:?}", e))?;

    eprintln!("[HID] Successfully parsed report descriptor");
    eprintln!("[HID] Input reports: {}", rdesc.input_reports().len());
    eprintln!("[HID] Output reports: {}", rdesc.output_reports().len());
    eprintln!("[HID] Feature reports: {}", rdesc.feature_reports().len());

    // Iterate through all input reports
    for report in rdesc.input_reports() {
        eprintln!(
            "[HID] Processing input report with ID: {:?}",
            report.report_id()
        );
        eprintln!("[HID] Report has {} fields", report.fields().len());

        // Iterate through all fields in the report
        for field in report.fields() {
            match field {
                Field::Variable(var) => {
                    // Filter out buttons (Usage Page 0x09)
                    if u16::from(var.usage.usage_page) == 0x09 {
                        continue;
                    }

                    // Variable fields are typically axes
                    let bits = var.bits.end - var.bits.start; // Range to size
                    let usage_val: u32 = ((u16::from(var.usage.usage_page) as u32) << 16)
                        | (u16::from(var.usage.usage_id) as u32);

                    // Use the usage ID as the axis index for consistency
                    // This matches how we assign indices in parse_hid_axes_from_descriptor_bytes
                    let axis_index = u16::from(var.usage.usage_id) as u32;

                    eprintln!(
                        "[HID] Variable field: {} bits, usage: 0x{:08X}",
                        bits, usage_val
                    );

                    // Get axis name
                    let axis_name = Usage::try_from(usage_val)
                        .ok()
                        .map(|u| u.name().to_string())
                        .unwrap_or_else(|| {
                            eprintln!(
                                "[HID] Warning: Could not resolve usage name for 0x{:08X}",
                                usage_val
                            );
                            format!(
                                "Unknown Usage {:04x}:{:04x}",
                                u16::from(var.usage.usage_page),
                                u16::from(var.usage.usage_id)
                            )
                        });

                    eprintln!(
                        "[HID] Found axis {}: {} ({} bits, usage: 0x{:08X})",
                        axis_index, axis_name, bits, usage_val
                    );
                    axis_names.insert(axis_index, axis_name);
                }
                Field::Array(arr) => {
                    // Array fields are typically buttons
                    let bits = arr.bits.end - arr.bits.start;
                    eprintln!("[HID] Array field: {} bits", bits);
                }
                Field::Constant(_) => {
                    // Constant fields are padding
                    eprintln!("[HID] Constant (padding) field");
                }
            }
        }
    }

    eprintln!("[HID] Total axes found: {}", axis_names.len());

    Ok(axis_names)
}
