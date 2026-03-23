import { AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { Adb, AdbDaemonTransport } from "@yume-chan/adb";

const shizuku_package_name = 'moe.shizuku.privileged.api';
const shizuku_script  = 'libshizuku.so';
const shizuku_download_url = 'https://app.apkz.com/app/'+shizuku_package_name+'/download';
const apkz_package_name = 'io.xapk.installer';
let device;
let deviceName;
let adb;

const log = (msg, clazz) => {
    if(!document.getElementById('cleanBtn')) {
        terminal.innerHTML += `<button id="cleanBtn" onclick="terminal.innerHTML='';">🗑️</button>`;
    }
    terminal.innerHTML += `<div class="${clazz || 'info'}"><time class="time">[${new Date().toLocaleTimeString()}]</time> <span>${msg}</span></div>`;
    terminal.scrollTop = terminal.scrollHeight;
};

const clearLogs = () => {
    terminal.innerHTML = '';
};

async function executeCommand(command) {
    console.log(`command: ${command}`);
    if (!adb) {
        disconnected();
        console.log("adb is not ready.");
        return '';
    }
    try {
        if (adb.subprocess.shellProtocol?.isSupported) {
            console.log("use shellProtocol");
            const result = await adb.subprocess.shellProtocol.spawnWaitText(command);
            console.log(result);
            return result.stdout || '';
        } else {
            console.log("use noneProtocol");
            const process = await adb.subprocess.noneProtocol.spawn(command);
            console.log(process);
            const reader = process.stdout.getReader();
            const chunks = [];
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(decoder.decode(value, { stream: true }));
            }
            return chunks.join('');
        }
    } catch (error) {
        console.error('executeCommand:', error);
        return '';
    }
}

async function connectDevice(_device) {
    try {
	device = _device || await AdbDaemonWebUsbDeviceManager.BROWSER?.requestDevice();
	console.log({device});
        
        if(!device || !device.raw) {
            log("Connection failed, please try again.", "error");
            log(`1. Please check if the USB is connected.`, 'warn');
            log(`2. Please check if developer options and USB debugging are enabled on your phone.`, 'warn')
            return;
        }

        deviceName = `${device.raw.manufacturerName} (${device.raw.productName})`;

	const credentialStore = new AdbWebCredentialStore();
	console.log({credentialStore});

	const connection = await device.connect();
	console.log({connection});

        statusText.innerText = "Authenticating...";
        setTimeout(function (){
            if(document.body.classList.contains('connected')) return;
            log(`Please tap "OK" on ${deviceName} to allow debugging.`, 'warn');
        }, 1000);

	const transport = await AdbDaemonTransport.authenticate({
		serial: device.serial,
		connection: connection,
		credentialStore: credentialStore,
	});
	console.log({transport});

	adb = new Adb(transport);
	console.log({adb});

        await adbReady();
    } catch (err) {
        console.error(err);
        let msg = err.message || '';
        if(msg.match(/(already in used)/i)) clearLogs();
        log(`Error: ${msg}`, "error");

        if(msg.indexOf('already in used') > -1){
            log(`If other adb programs are already running, please execute <code>adb kill-server</code> to stop them first.`, 'warn');
            log(`If Android Studio is open, please close it first.`, 'warn');
        }
    }

}

async function adbReady() {
    if(!device || !adb) return disconnected();

    let serialno = await adb.getProp('ro.serialno');
    console.log({serialno});
    console.log(device['#serial']);
    if(!serialno || serialno !== device.raw.serialNumber) return disconnected();

    clearLogs();
    document.body.classList.add('connected');
    statusText.innerText = `Connected: ${deviceName}`;
    log(`Connected: ${deviceName} `, 'succ');

    if(location.hash.indexOf('debug=1')>-1) window.adb = adb;
    if(location.hash.indexOf('btn=shizuku')>-1){
        startBtn.click();
    }else if(location.hash.indexOf('btn=tcpip')>-1) {
        tcpipBtn.click();
    }
}

function disconnected() {
    
    device = null;
    deviceName = null;
    adb = null;
    
    document.body.classList.remove('connected');
    statusText.innerText = "Not connected";
}

connectBtn.onclick = async () => {
    if(connectBtn.classList.contains('dim')){
        disclaimer.showModal();
        return;
    }
    await connectDevice(device);
};

startBtn.onclick = async () => {
    let cmd, result;
    try {
	cmd = `pm path ${shizuku_package_name}`;
        log(`Checking if Shizuku is installed...`);
        //log('......');
        //log(cmd);
        //log('......');
        result = await executeCommand(cmd);

    } catch (err) {
        log(`Error: ${err.message}`, "error");
    }
    
    let [, shizuku_path] = result.match(/package:(.+)\/base.apk/) || [];
    if(!shizuku_path){
        log(`Oops! ${result}`, 'error');
        log(`Please install Shizuku on ${deviceName} first.`, 'warn');

	cmd = `am start -a android.intent.action.VIEW -d "${shizuku_download_url}"`;
        await executeCommand(cmd);
        return;
    }

    try {
        cmd = `find ${shizuku_path} -name "${shizuku_script}" 2>/dev/null`;
        result = ((await executeCommand(cmd)) || '').trim();
        log(result);
        if(!result || result.indexOf(shizuku_path) !== 0 || result.substr(-shizuku_script.length) !== shizuku_script){
            log(`Oops! Startup script not found`, 'error');
            log(`Please update Shizuku first.`);

	    cmd = `am start -a android.intent.action.VIEW -d "${shizuku_download_url}"`;
            await executeCommand(cmd);
            return;
        }

        cmd = result;
        log(`Starting Shizuku...`);
        //log('......');
        //log(cmd);
        //log('......');
        result = await executeCommand(cmd);

        log(result)
    } catch (err) {
        log(`Error: ${err.message}`, 'error');
    }

    if(!result.match(/shizuku_server pid is \d+/)){
        log(`Oops! ${result}`, 'error');
        log("Shizuku failed to start.", 'error');
        return;
    }
	
    log("Shizuku started successfully. You can unplug the USB cable now.", 'succ');

    if(location.hash.indexOf('APKZ') > -1) openAPKZ();
}

function openAPKZ() {
    log(`APKZ app will open on ${deviceName}.`, 'warn');
    
    let i = 3;
    let timer = setInterval(async function (){
        if(i > 0){
            log(`${i--}`);
            return;
        }
        clearInterval(timer);
        
        try {
	    cmd = `am start -S -p ${apkz_package_name} -a android.intent.action.VIEW -d "https://app.apkz.com/shizuku"`;
            result = await executeCommand(cmd);
        
        } catch (err) {
            log(`Error: ${err.message}`, 'error');
        }
    }, 1000);

};

tcpipBtn.onclick = async () => {
    try {
        let _device = deviceName;
        let _ip = (await executeCommand("ip addr show wlan0 | grep 'inet ' | cut -d' ' -f6 | cut -d/ -f1")).trim();
        let _target = _ip ? _ip+':5555' : '::';
        log(`Activating wireless debugging...`);
        setTimeout(function (){
            if(!device){
                log(`Your phone (${_device}) has wireless debugging enabled.`, 'succ');
                log(`To connect, run <code>adb connect ${_target}</code>`, 'warn');
            }
        },1000);
        let result = await adb.tcpip.setPort(5555);;
        log(result);
        console.log({result});

    } catch (err) {
        log(`Error: ${err.message || 'disconnected'}`, "error");
    }
};

if(navigator.usb){
    navigator.usb.addEventListener("connect", (event) => {
        console.log(`usb.connect: ${event.device.productName}`);
        console.log(event.device);
    });
    navigator.usb.addEventListener("disconnect", (event) => {
        console.log(`usb.disconnect: ${event.device.productName}`);
        console.log(event.device);
        
        disconnected();
    });
}else{
    log('Your current browser does not support WebUSB. Please open this page in Chrome or Edge browser.', 'error');
}
