use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

pub fn socket_path(data_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let _ = data_dir;
        PathBuf::from(r"\\.\pipe\liquitask-agentd")
    }
    #[cfg(unix)]
    {
        data_dir.join("agentd.sock")
    }
}

#[cfg(unix)]
pub fn connect_socket(
    data_dir: &Path,
) -> Result<(Box<dyn Write + Send>, Box<dyn BufRead + Send>), String> {
    let stream = std::os::unix::net::UnixStream::connect(socket_path(data_dir))
        .map_err(|e| format!("connect socket: {e}"))?;
    let reader = BufReader::new(
        stream
            .try_clone()
            .map_err(|e| format!("clone reader: {e}"))?,
    );
    Ok((Box::new(stream), Box::new(reader)))
}

#[cfg(windows)]
pub fn connect_socket(
    data_dir: &Path,
) -> Result<(Box<dyn Write + Send>, Box<dyn BufRead + Send>), String> {
    let _ = data_dir;
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::FILE_SHARE_READ;
    use windows::Win32::Storage::FileSystem::FILE_SHARE_WRITE;

    let pipe = r"\\.\pipe\liquitask-agentd";
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)
        .open(pipe)
        .map_err(|e| format!("connect pipe: {e}"))?;
    let reader = file.try_clone().map_err(|e| format!("clone pipe: {e}"))?;
    Ok((Box::new(file), Box::new(BufReader::new(reader))))
}
