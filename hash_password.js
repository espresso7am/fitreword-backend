const bcrypt = require('bcryptjs');

//  ! ضع كلمة المرور التي تريدها هنا
const passwordToHash = 'Adaah010';

const saltRounds = 10;

bcrypt.hash(passwordToHash, saltRounds, (err, hash) => {
    if (err) {
        console.error('Error hashing password:', err);
        return;
    }
    console.log('✅ New Password Hash Generated Successfully!');
    console.log('⬇️ Copy the hash below and paste it into data.json');
    console.log('----------------------------------------------------');
    console.log(hash);
    console.log('----------------------------------------------------');
});
