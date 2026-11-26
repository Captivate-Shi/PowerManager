use tauri::{PhysicalPosition, Position, Rect, Size, WebviewWindow};

#[derive(Clone, Copy)]
pub struct Anchor {
    pub point: PhysicalPosition<f64>,
    top: f64,
    bottom: f64,
}
impl Anchor {
    pub fn from_point(x: f64, y: f64) -> Self {
        Self { point: PhysicalPosition::new(x, y), top: y, bottom: y }
    }
}
pub fn icon_anchor(rect: Rect) -> Option<Anchor> {
    let (Position::Physical(p), Size::Physical(size)) = (rect.position, rect.size) else { return None; };
    if size.width == 0 || size.height == 0 { return None; }
    Some(Anchor {
        point: PhysicalPosition::new(p.x as f64 + size.width as f64 / 2., p.y as f64 + size.height as f64 / 2.),
        top: p.y as f64,
        bottom: p.y as f64 + size.height as f64,
    })
}

pub fn click_anchor(cursor: PhysicalPosition<f64>, rect: Rect) -> Anchor {
    let point = Anchor::from_point(cursor.x, cursor.y);
    // Some overflow registrations return an empty or stale icon rectangle.
    icon_anchor(rect).filter(|icon|
        (icon.point.x - cursor.x).abs() <= 48. && cursor.y >= icon.top - 12. && cursor.y <= icon.bottom + 12.
    ).unwrap_or(point)
}

fn panel_position(anchor: Anchor, area: [i32; 4], size: [i32; 2], gap: i32) -> PhysicalPosition<i32> {
    let [left, top, right, bottom] = area;
    let [width, height] = size;
    let x = (anchor.point.x - width as f64 / 2.).round() as i32;
    let y = if anchor.point.y < (top as f64 + bottom as f64) / 2. {
        anchor.bottom.round() as i32 + gap
    } else {
        ((anchor.top.round() as i32).min(bottom)) - gap - height
    };
    PhysicalPosition::new(x.clamp(left, (right - width).max(left)), y.clamp(top, (bottom - height).max(top)))
}

pub fn place(window: &WebviewWindow, anchor: Option<Anchor>) -> tauri::Result<()> {
    let monitor = match anchor {
        Some(anchor) => window.monitor_from_point(anchor.point.x, anchor.point.y)?.or(window.current_monitor()?),
        None => window.current_monitor()?,
    }.or(window.primary_monitor()?);
    let Some(monitor) = monitor else { return Ok(()) };
    let area = monitor.work_area();
    let current = window.outer_size()?;
    let right = area.position.x + area.size.width as i32;
    let bottom = area.position.y + area.size.height as i32;
    let scale = monitor.scale_factor();
    let ratio = scale / window.scale_factor()?;
    let size = [(current.width as f64 * ratio).round() as i32, (current.height as f64 * ratio).round() as i32];
    let gap = (4.0 * scale).round() as i32;
    let anchor = anchor.unwrap_or_else(|| Anchor::from_point((right - 3 * gap - size[0] / 2) as f64, bottom as f64));
    window.set_position(panel_position(anchor, [area.position.x, area.position.y, right, bottom], size, gap))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rect(x: i32, y: i32, w: u32, h: u32) -> Rect {
        Rect {position: PhysicalPosition::new(x,y).into(), size: tauri::PhysicalSize::new(w,h).into()}
    }
    #[test]
    fn anchored_to_icon_and_clamped_to_right_edge() {
        let area = [0,0,2560,1392];
        let anchor = click_anchor(PhysicalPosition::new(2140.,1418.),rect(2132,1410,20,18));
        assert_eq!(panel_position(anchor,area,[420,565],4),PhysicalPosition::new(1932,823));
        assert_eq!(panel_position(Anchor::from_point(2536.,1418.),area,[420,565],4).x,2140);
    }
    #[test]
    fn overflow_missing_or_stale_bounds_prioritize_actual_click() {
        let pointer = PhysicalPosition::new(1940.,1280.);
        for r in [rect(0,0,0,0),rect(2520,1400,24,22)] {
            assert_eq!(panel_position(click_anchor(pointer,r),[0,0,2560,1392],[420,565],4),PhysicalPosition::new(1730,711));
        }
    }
    #[test]
    fn upper_icon_stays_near_click_on_secondary_monitor() {
        let a = icon_anchor(rect(-1060,60,20,20)).unwrap();
        assert_eq!(panel_position(a,[-1920,48,0,1080],[525,706],5),PhysicalPosition::new(-1313,85));
    }
}
