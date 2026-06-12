if ('service-worker' in navigator){
    navigator.service-worker.getRegistrations().then((registratons) => {
        registrations.forEach((registration) => {
            registration.update();
        });
    });

}

// force refresh once

window.onload = () => {
    if(!sessionStorage.getItem('reloaded')){
        sessionStorage.setItem('reloaded', true);
        window.location.reload();
    }else{
        sessionStorage.removeItem('reloaded');
    }
};