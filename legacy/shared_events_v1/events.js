'use strict';

module.exports = {
  CLIENT: {
    REGISTER: 'client:register',
    SEND_ROOM_TEXT: 'client:send-room-text',
    SEND_ROOM_MEDIA: 'client:send-room-media',
    SEND_DM_TEXT: 'client:send-dm-text',
    JOIN_ROOM: 'client:join-room',
    LEAVE_ROOM: 'client:leave-room',
    OTP_CONFIRM: 'client:otp-confirm'
  },
  SERVER: {
    REGISTERED: 'server:registered',
    USER_JOINED: 'server:user-joined',
    USER_LEFT: 'server:user-left',
    ROOM_MESSAGE: 'server:room-message',
    ROOM_MEDIA: 'server:room-media',
    DIRECT_MESSAGE: 'server:direct-message',
    SYSTEM: 'server:system',
    OTP_CONFIRM_REQUEST: 'server:otp-confirm-request',
    USER_LIST: 'server:user-list',
    ROOM_LIST: 'server:room-list'
  }
};
